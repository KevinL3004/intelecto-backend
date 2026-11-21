import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { BitacoraService } from '../bitacora/bitacora.service';
import { sesionCache } from '../../common/guards/estado-usuario';

/** Sin actividad por más de este tiempo, la sesión expira aunque no haya llegado a su vida máxima. */
const INACTIVIDAD_MAX_MS = 12 * 60 * 60 * 1000;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const iguales = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MotivoRevocacion =
  'LOGOUT' | 'REUSO' | 'CAMBIO_PASSWORD' | 'RESET_PASSWORD' | 'USUARIO_DESACTIVADO' | 'EXPIRADA';

/**
 * Sesiones con refresh token opaco y rotación (OWASP ASVS V3):
 * cada uso entrega uno nuevo; presentar uno ya rotado revoca la sesión (posible robo).
 */
@Injectable()
export class SesionesService {
  constructor(
    private readonly ds: DataSource,
    private readonly config: ConfigService,
    private readonly bitacora: BitacoraService,
  ) {}

  private vidaMaxMs() {
    const v = String(this.config.get('JWT_REFRESH_EXPIRES_IN', '7d'));
    const m = /^(\d+)([dh])$/.exec(v);
    if (!m) return 7 * 24 * 3600 * 1000;
    return Number(m[1]) * (m[2] === 'd' ? 24 : 1) * 3600 * 1000;
  }

  /** Crea la sesión y devuelve su id y el refresh token (solo esta vez se conoce en claro). */
  async crear(usuarioId: number, ip: string, userAgent: string) {
    const secreto = randomBytes(32).toString('base64url');
    const [s] = await this.ds.query(
      `INSERT INTO sesion (usuario_id, refresh_hash, ip, user_agent, expira_en)
       VALUES ($1, $2, $3, $4, now() + ($5 || ' milliseconds')::interval) RETURNING id`,
      [
        usuarioId,
        sha256(secreto),
        ip || null,
        (userAgent || '').slice(0, 200) || null,
        this.vidaMaxMs(),
      ],
    );
    return { sesionId: s.id as string, refreshToken: `${s.id}.${secreto}` };
  }

  /**
   * Valida y rota el refresh token. Devuelve el usuario y el nuevo refresh token.
   * Si el token ya había sido rotado (reúso), revoca la sesión completa.
   */
  async rotar(refreshToken: string, ip: string) {
    const invalido = new UnauthorizedException('Sesión inválida o expirada');
    const [sesionId, secreto] = String(refreshToken).split('.');
    if (!sesionId || !secreto || !UUID.test(sesionId) || secreto.length > 100) throw invalido;

    // La transacción NO lanza errores para los casos de rechazo: si lo hiciera, el rollback
    // desharía la revocación. Devuelve un resultado y la revocación queda confirmada (commit).
    const r = await this.ds.transaction(async (m) => {
      const [s] = await m.query(
        `SELECT id, usuario_id AS "usuarioId", refresh_hash AS hash, revocada_en AS "revocadaEn",
                expira_en AS "expiraEn", ultimo_uso AS "ultimoUso"
           FROM sesion WHERE id = $1 FOR UPDATE`,
        [sesionId],
      );
      if (!s || s.revocadaEn) return { estado: 'INVALIDA' as const };
      const ahora = Date.now();
      if (
        new Date(s.expiraEn).getTime() < ahora ||
        ahora - new Date(s.ultimoUso).getTime() > INACTIVIDAD_MAX_MS
      ) {
        await this.revocarEn(m, s.id, 'EXPIRADA');
        return { estado: 'INVALIDA' as const };
      }
      if (!iguales(sha256(secreto), s.hash)) {
        // Un refresh ya usado volvió a aparecer: alguien más lo tiene. Se corta la sesión.
        await this.revocarEn(m, s.id, 'REUSO');
        await this.bitacora.registrar(
          {
            usuarioId: s.usuarioId,
            accion: 'SESION_REUSO_DETECTADO',
            entidad: 'sesion',
            entidadId: s.id,
            ip,
          },
          m,
        );
        return { estado: 'INVALIDA' as const };
      }
      const nuevo = randomBytes(32).toString('base64url');
      await m.query(
        `UPDATE sesion SET refresh_hash = $2, ultimo_uso = now(), ip = $3 WHERE id = $1`,
        [s.id, sha256(nuevo), ip || null],
      );
      return {
        estado: 'OK' as const,
        usuarioId: s.usuarioId as number,
        sesionId: s.id as string,
        refreshToken: `${s.id}.${nuevo}`,
      };
    });
    if (r.estado !== 'OK') throw invalido;
    return r;
  }

  /** ¿La sesión sigue vigente? (lo consulta el guard en cada petición, con caché corto). */
  async activa(sesionId: string): Promise<boolean> {
    if (!UUID.test(sesionId)) return false;
    const enCache = sesionCache.leer(sesionId);
    if (enCache !== undefined) return enCache;
    const [s] = await this.ds.query(
      `SELECT (revocada_en IS NULL AND expira_en > now()) AS activa FROM sesion WHERE id = $1`,
      [sesionId],
    );
    const activa = !!s?.activa;
    sesionCache.guardar(sesionId, activa);
    return activa;
  }

  revocar(sesionId: string, motivo: MotivoRevocacion) {
    return this.revocarEn(this.ds.manager, sesionId, motivo);
  }

  /** Revoca todas las sesiones del usuario (opcionalmente, menos la actual). */
  async revocarTodas(usuarioId: number, motivo: MotivoRevocacion, excepto?: string) {
    const ids: { id: string }[] = await this.ds.query(
      `UPDATE sesion SET revocada_en = now(), motivo_revocacion = $2
        WHERE usuario_id = $1 AND revocada_en IS NULL AND ($3::uuid IS NULL OR id <> $3)
        RETURNING id`,
      [usuarioId, motivo, excepto ?? null],
    );
    ids.forEach((x) => sesionCache.invalidar(x.id));
    return ids.length;
  }

  private async revocarEn(
    m: { query: DataSource['query'] },
    sesionId: string,
    motivo: MotivoRevocacion,
  ) {
    await m.query(
      `UPDATE sesion SET revocada_en = now(), motivo_revocacion = $2 WHERE id = $1 AND revocada_en IS NULL`,
      [sesionId, motivo],
    );
    sesionCache.invalidar(sesionId);
  }
}
