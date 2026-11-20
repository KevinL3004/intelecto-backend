import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In, QueryFailedError } from 'typeorm';
import Decimal from 'decimal.js';
import { Caja, Denominacion, TurnoCaja } from '../../database/entities';
import { UsuarioActual } from '../../common/decorators';
import { Rol } from '../../common/roles';
import { BusinessError } from '../../common/errors';
import { paginate } from '../../common/dto/pagination.dto';
import { money, totalConteo } from '../../common/utils/money';
import { BitacoraService } from '../bitacora/bitacora.service';
import { cuadreEfectivo, efectivoEsperado } from './reglas-turno';
import {
  AbrirTurnoDto,
  CerrarTurnoDto,
  ConteoItemDto,
  FiltroTurnosDto,
  MovimientoCajaDto,
  ValidarTurnoDto,
} from './dto/turno.dto';

const ACTIVOS = ['ABIERTO', 'EN_CIERRE'];
const esSupervisor = (u: UsuarioActual) => u.rol === Rol.ADMIN || u.rol === Rol.CONTADOR;

export interface ResumenTurno {
  ventas: number;
  efectivoVentas: string;
  tarjeta: string;
  transferencia: string;
  retiros: string;
  ingresos: string;
  reembolsos: string;
  efectivoEsperado: string;
}

@Injectable()
export class TurnosService {
  constructor(
    private readonly ds: DataSource,
    private readonly bitacora: BitacoraService,
  ) {}

  denominaciones() {
    return this.ds
      .getRepository(Denominacion)
      .find({ where: { activo: true }, order: { orden: 'ASC' } });
  }

  /** Cajas activas sin turno abierto. El cajero solo ve las de su colegio. */
  cajasDisponibles(u: UsuarioActual, colegioId?: number) {
    const colegio = u.rol === Rol.CAJERO ? u.colegioId : colegioId;
    return this.ds.query(
      `SELECT c.id, c.numero, c.colegio_id AS "colegioId", co.nombre AS colegio,
              c.fondo_asignado AS "fondoAsignado"
         FROM caja c JOIN colegio co ON co.id = c.colegio_id
        WHERE c.activa AND co.activo
          AND ($1::bigint IS NULL OR c.colegio_id = $1)
          AND NOT EXISTS (SELECT 1 FROM turno_caja t WHERE t.caja_id = c.id AND t.estado IN ('ABIERTO','EN_CIERRE'))
        ORDER BY co.nombre, c.numero`,
      [colegio ?? null],
    );
  }

  /** Turno activo (ABIERTO o EN_CIERRE) del usuario, o null. */
  async actual(usuarioId: number) {
    const [t] = await this.ds.query(
      `SELECT t.id, t.estado, t.fondo_inicial AS "fondoInicial", t.abierto_en AS "abiertoEn",
              c.id AS "cajaId", c.numero AS "cajaNumero", c.colegio_id AS "colegioId", co.nombre AS colegio,
              EXISTS (SELECT 1 FROM turno_denominacion d WHERE d.turno_id = t.id AND d.momento = 'CIERRE') AS "conteoRegistrado"
         FROM turno_caja t JOIN caja c ON c.id = t.caja_id JOIN colegio co ON co.id = c.colegio_id
        WHERE t.usuario_id = $1 AND t.estado IN ('ABIERTO','EN_CIERRE')`,
      [usuarioId],
    );
    return t ?? null;
  }

  async listar(f: FiltroTurnosDto, u: UsuarioActual) {
    const params: unknown[] = [];
    const where: string[] = [];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    if (u.rol === Rol.CAJERO) where.push(`t.usuario_id = ${p(u.id)}`);
    if (f.estado) where.push(`t.estado = ${p(f.estado)}`);
    if (f.colegioId) where.push(`c.colegio_id = ${p(f.colegioId)}`);
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [{ total }] = await this.ds.query(
      `SELECT count(*)::int AS total FROM turno_caja t JOIN caja c ON c.id = t.caja_id ${w}`,
      params,
    );
    const data = await this.ds.query(
      `SELECT t.id, t.estado, t.forzado, t.fondo_inicial AS "fondoInicial",
              t.efectivo_esperado AS "efectivoEsperado", t.efectivo_contado AS "efectivoContado",
              t.diferencia_efectivo AS "diferencia", t.abierto_en AS "abiertoEn", t.cerrado_en AS "cerradoEn",
              c.numero AS "cajaNumero", co.nombre AS colegio, u.username,
              trim(pe.nombres || ' ' || pe.apellidos) AS cajero
         FROM turno_caja t
         JOIN caja c ON c.id = t.caja_id JOIN colegio co ON co.id = c.colegio_id
         JOIN usuario u ON u.id = t.usuario_id JOIN persona pe ON pe.id = u.persona_id
         ${w}
        ORDER BY t.abierto_en DESC
        LIMIT ${p(f.limit)} OFFSET ${p((f.page - 1) * f.limit)}`,
      params,
    );
    // Cierre ciego: el cajero no ve el esperado de su turno mientras no esté cerrado.
    if (u.rol === Rol.CAJERO)
      for (const t of data) if (ACTIVOS.includes(t.estado)) t.efectivoEsperado = null;
    return paginate(data, total, f);
  }

  /** CU-02: apertura con fondo por denominaciones (RN-04: un turno activo por caja y por usuario). */
  async abrir(dto: AbrirTurnoDto, u: UsuarioActual, ip: string) {
    try {
      return await this.ds.transaction(async (m) => {
        const caja = await m.getRepository(Caja).findOne({
          where: { id: dto.cajaId },
          relations: { colegio: true },
        });
        if (!caja || !caja.activa || !caja.colegio.activo)
          throw new NotFoundException('Caja no encontrada o inactiva');
        if (u.rol === Rol.CAJERO && caja.colegioId !== u.colegioId)
          throw new ForbiddenException('Solo puede abrir cajas de su colegio');
        if (await this.actual(u.id))
          throw new BusinessError(
            'TURNO_YA_ABIERTO',
            'Ya tiene un turno abierto. Ciérrelo primero.',
          );

        const fondo = await this.totalizar(m, dto.conteo);
        const asignado = money(caja.fondoAsignado);
        if (!fondo.eq(asignado) && !dto.observacion)
          throw new BusinessError(
            'FONDO_DIFERENTE',
            `El fondo contado (Q${fondo.toFixed(2)}) no coincide con el asignado (Q${asignado.toFixed(2)}). Escriba una observación.`,
            422,
          );

        const t = await m.getRepository(TurnoCaja).save(
          m.getRepository(TurnoCaja).create({
            cajaId: caja.id,
            usuarioId: u.id,
            estado: 'ABIERTO',
            fondoInicial: fondo.toFixed(2),
            observacionApertura: dto.observacion ?? null,
            forzado: false,
          }),
        );
        await this.guardarConteo(m, t.id, 'APERTURA', dto.conteo);
        await this.bitacora.registrar(
          {
            usuarioId: u.id,
            accion: 'ABRIR_TURNO',
            entidad: 'turno_caja',
            entidadId: t.id,
            despues: { caja: caja.numero, colegio: caja.colegio.nombre, fondo: t.fondoInicial },
            ip,
          },
          m,
        );
        return this.actual(u.id).then((a) => a ?? t);
      });
    } catch (e) {
      if (
        e instanceof QueryFailedError &&
        (e as QueryFailedError & { code?: string }).code === '23505'
      )
        throw new BusinessError('CAJA_OCUPADA', 'La caja ya tiene un turno abierto');
      throw e;
    }
  }

  /** CU-06 paso 1: el turno pasa a EN_CIERRE (ya no se puede vender). */
  async iniciarCierre(id: number, u: UsuarioActual, ip: string) {
    return this.ds.transaction(async (m) => {
      const t = await this.cargar(m, id, u, true);
      if (t.estado !== 'ABIERTO')
        throw new BusinessError('TURNO_NO_ABIERTO', 'El turno no está abierto');
      await m.getRepository(TurnoCaja).update(id, { estado: 'EN_CIERRE' });
      await this.bitacora.registrar(
        { usuarioId: u.id, accion: 'INICIAR_CIERRE', entidad: 'turno_caja', entidadId: id, ip },
        m,
      );
      return { estado: 'EN_CIERRE' };
    });
  }

  /** CU-06 A1: cancela el cierre si aún no se registró el conteo. */
  async cancelarCierre(id: number, u: UsuarioActual, ip: string) {
    return this.ds.transaction(async (m) => {
      const t = await this.cargar(m, id, u, true);
      if (t.estado !== 'EN_CIERRE')
        throw new BusinessError('TURNO_NO_EN_CIERRE', 'El turno no está en cierre');
      if (await this.tieneConteo(m, id, 'CIERRE'))
        throw new BusinessError(
          'CONTEO_REGISTRADO',
          'El conteo de cierre ya se registró; no se puede volver a abrir el turno',
        );
      await m.getRepository(TurnoCaja).update(id, { estado: 'ABIERTO' });
      await this.bitacora.registrar(
        { usuarioId: u.id, accion: 'CANCELAR_CIERRE', entidad: 'turno_caja', entidadId: id, ip },
        m,
      );
      return { estado: 'ABIERTO' };
    });
  }

  /**
   * CU-06: cierre ciego. El conteo se registra UNA sola vez (no se puede "ajustar" después de ver
   * la diferencia). Si hay diferencia o es forzado, se pide observación y el turno sigue EN_CIERRE
   * hasta que se envíe.
   */
  async cerrar(id: number, dto: CerrarTurnoDto, u: UsuarioActual, ip: string) {
    const r = await this.ds.transaction(async (m) => {
      const t = await this.cargar(m, id, u, true);
      if (t.estado !== 'EN_CIERRE')
        throw new BusinessError('TURNO_NO_EN_CIERRE', 'Primero inicie el cierre del turno');
      const forzado = t.usuarioId !== u.id;

      const registrado = await this.tieneConteo(m, id, 'CIERRE');
      if (registrado && dto.conteo)
        throw new BusinessError(
          'CONTEO_REGISTRADO',
          'El conteo ya fue registrado; solo falta la observación',
        );
      if (!registrado) {
        if (!dto.conteo)
          throw new BusinessError('CONTEO_REQUERIDO', 'Ingrese el conteo por denominación', 422);
        await this.totalizar(m, dto.conteo);
        await this.guardarConteo(m, id, 'CIERRE', dto.conteo);
      }

      const contado = await this.totalGuardado(m, id, 'CIERRE');
      const res = await this.resumen(m, id, t.fondoInicial);
      const cuadre = cuadreEfectivo(contado, res.efectivoEsperado, t.fondoInicial);
      const requiere = !cuadre.cuadra || forzado;
      if (requiere && !dto.observacion)
        return {
          estado: 'EN_CIERRE' as const,
          requiereObservacion: true,
          motivo: forzado
            ? 'Cierre forzado: la observación es obligatoria'
            : 'Hay diferencia de efectivo',
          efectivoContado: contado.toFixed(2),
          efectivoEsperado: res.efectivoEsperado,
          diferencia: cuadre.diferencia,
        };

      await m.getRepository(TurnoCaja).update(id, {
        estado: 'CERRADO',
        efectivoEsperado: res.efectivoEsperado,
        efectivoContado: contado.toFixed(2),
        diferenciaEfectivo: cuadre.diferencia,
        tarjetaEsperado: res.tarjeta,
        transferenciaEsperado: res.transferencia,
        observacionCierre: dto.observacion ?? null,
        forzado,
        cerradoPor: u.id,
        cerradoEn: new Date(),
      });
      await this.bitacora.registrar(
        {
          usuarioId: u.id,
          accion: forzado ? 'CIERRE_FORZADO' : 'CERRAR_TURNO',
          entidad: 'turno_caja',
          entidadId: id,
          despues: {
            ...res,
            contado: contado.toFixed(2),
            diferencia: cuadre.diferencia,
            observacion: dto.observacion,
          },
          ip,
        },
        m,
      );
      return { estado: 'CERRADO' as const };
    });
    return r.estado === 'CERRADO' ? { estado: 'CERRADO', acta: await this.acta(id, u) } : r;
  }

  /** CU-11: el Contador valida (u observa) el cierre al recibir el efectivo. */
  async validar(id: number, dto: ValidarTurnoDto, u: UsuarioActual, ip: string) {
    return this.ds.transaction(async (m) => {
      const t = await this.cargar(m, id, u, true);
      if (!['CERRADO', 'OBSERVADO'].includes(t.estado))
        throw new BusinessError('TURNO_NO_CERRADO', 'Solo se validan turnos cerrados');
      if (dto.resultado === 'OBSERVADO' && !dto.observacion)
        throw new BusinessError('OBSERVACION_REQUERIDA', 'Escriba la observación', 422);
      await m.getRepository(TurnoCaja).update(id, {
        estado: dto.resultado,
        validadoPor: u.id,
        validadoEn: new Date(),
        observacionValidacion: dto.observacion ?? null,
      });
      await this.bitacora.registrar(
        {
          usuarioId: u.id,
          accion: dto.resultado === 'VALIDADO' ? 'VALIDAR_TURNO' : 'OBSERVAR_TURNO',
          entidad: 'turno_caja',
          entidadId: id,
          antes: { estado: t.estado },
          despues: dto,
          ip,
        },
        m,
      );
      return { estado: dto.resultado };
    });
  }

  /** Retiros parciales (sangrías) e ingresos de efectivo. Solo Admin/Contador. */
  async movimiento(id: number, dto: MovimientoCajaDto, u: UsuarioActual, ip: string) {
    return this.ds.transaction(async (m) => {
      const t = await this.cargar(m, id, u, true);
      if (t.estado !== 'ABIERTO')
        throw new BusinessError('TURNO_NO_ABIERTO', 'El turno no está abierto');
      const monto = money(dto.monto);
      if (monto.lte(0))
        throw new BusinessError('MONTO_INVALIDO', 'El monto debe ser mayor a 0', 422);
      if (dto.tipo === 'RETIRO') {
        const { efectivoEsperado: hay } = await this.resumen(m, id, t.fondoInicial);
        if (monto.gt(hay))
          throw new BusinessError(
            'EFECTIVO_INSUFICIENTE',
            `La caja tiene Q${hay} en efectivo; no se pueden retirar Q${monto.toFixed(2)}`,
            422,
          );
      }
      const [mov] = await m.query(
        `INSERT INTO movimiento_caja (turno_id, tipo, monto, motivo, referencia, usuario_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [id, dto.tipo, monto.toFixed(2), dto.motivo, dto.referencia ?? null, u.id],
      );
      await this.bitacora.registrar(
        {
          usuarioId: u.id,
          accion: dto.tipo,
          entidad: 'turno_caja',
          entidadId: id,
          despues: dto,
          ip,
        },
        m,
      );
      return { id: mov.id };
    });
  }

  /** R-08: acta del turno. Mientras el turno está activo el cajero no ve el esperado (cierre ciego). */
  async acta(id: number, u: UsuarioActual) {
    const m = this.ds.manager;
    const t = await this.cargar(m, id, u, false);
    const [info] = await m.query(
      `SELECT c.numero AS "cajaNumero", co.nombre AS colegio, us.username,
              trim(pe.nombres || ' ' || pe.apellidos) AS cajero,
              (SELECT username FROM usuario WHERE id = t.cerrado_por) AS "cerradoPor",
              (SELECT username FROM usuario WHERE id = t.validado_por) AS "validadoPor"
         FROM turno_caja t JOIN caja c ON c.id = t.caja_id JOIN colegio co ON co.id = c.colegio_id
         JOIN usuario us ON us.id = t.usuario_id JOIN persona pe ON pe.id = us.persona_id
        WHERE t.id = $1`,
      [id],
    );
    const conteos = await m.query(
      `SELECT d.momento, n.id AS "denominacionId", n.valor, n.tipo, d.cantidad,
              (n.valor * d.cantidad)::numeric(12,2)::text AS subtotal
         FROM turno_denominacion d JOIN denominacion n ON n.id = d.denominacion_id
        WHERE d.turno_id = $1 ORDER BY d.momento, n.orden`,
      [id],
    );
    const pagos = await m.query(
      `SELECT p.id, v.codigo AS venta, mp.codigo AS metodo, mp.nombre, p.medio, p.referencia,
              p.monto_base AS "montoBase", p.recargo, p.monto_total AS "montoTotal", p.anulado, p.fecha
         FROM venta_pago p JOIN venta v ON v.id = p.venta_id JOIN metodo_pago mp ON mp.id = p.metodo_pago_id
        WHERE p.turno_id = $1 AND mp.codigo <> 'EFECTIVO'
        ORDER BY p.fecha`,
      [id],
    );
    const movimientos = await m.query(
      `SELECT mc.id, mc.tipo, mc.monto, mc.motivo, mc.referencia, mc.fecha, u.username AS usuario
         FROM movimiento_caja mc JOIN usuario u ON u.id = mc.usuario_id
        WHERE mc.turno_id = $1 ORDER BY mc.fecha`,
      [id],
    );
    const activo = ACTIVOS.includes(t.estado);
    const res = await this.resumen(m, id, t.fondoInicial);
    const contado = t.efectivoContado;
    const oculto = activo && !esSupervisor(u);
    const cuadre = contado
      ? cuadreEfectivo(contado, t.efectivoEsperado ?? res.efectivoEsperado, t.fondoInicial)
      : null;
    return {
      id: t.id,
      estado: t.estado,
      forzado: t.forzado,
      ...info,
      abiertoEn: t.abiertoEn,
      cerradoEn: t.cerradoEn,
      validadoEn: t.validadoEn,
      fondoInicial: t.fondoInicial,
      observacionApertura: t.observacionApertura,
      observacionCierre: t.observacionCierre,
      observacionValidacion: t.observacionValidacion,
      conteoApertura: conteos.filter((c: { momento: string }) => c.momento === 'APERTURA'),
      conteoCierre: conteos.filter((c: { momento: string }) => c.momento === 'CIERRE'),
      resumen: {
        ventas: res.ventas,
        efectivoVentas: oculto ? null : res.efectivoVentas,
        tarjeta: res.tarjeta,
        transferencia: res.transferencia,
        retiros: res.retiros,
        ingresos: res.ingresos,
        reembolsos: res.reembolsos,
        // Para turnos cerrados se usa lo guardado al cerrar (no cambia aunque luego se anule algo).
        efectivoEsperado: oculto ? null : (t.efectivoEsperado ?? res.efectivoEsperado),
        efectivoContado: contado,
        diferencia: t.diferenciaEfectivo,
        fondoAConservar: t.fondoInicial,
        efectivoAEntregar: cuadre?.aEntregar ?? null,
      },
      pagos,
      movimientos,
    };
  }

  // ---------- auxiliares ----------

  /** Carga el turno (con bloqueo opcional) y verifica que el usuario pueda operar sobre él. */
  private async cargar(m: EntityManager, id: number, u: UsuarioActual, bloquear: boolean) {
    const qb = m.getRepository(TurnoCaja).createQueryBuilder('t').where('t.id = :id', { id });
    if (bloquear) qb.setLock('pessimistic_write');
    const t = await qb.getOne();
    if (!t) throw new NotFoundException('Turno no encontrado');
    if (t.usuarioId !== u.id && !esSupervisor(u))
      throw new ForbiddenException('Solo puede operar su propio turno');
    return t;
  }

  async resumen(m: EntityManager, turnoId: number, fondoInicial: string): Promise<ResumenTurno> {
    const [r] = await m.query(
      `SELECT
         (SELECT count(DISTINCT p.venta_id)::int FROM venta_pago p WHERE p.turno_id = $1 AND NOT p.anulado) AS ventas,
         coalesce((SELECT sum(p.monto_total) FROM venta_pago p JOIN metodo_pago mp ON mp.id = p.metodo_pago_id
                    WHERE p.turno_id = $1 AND NOT p.anulado AND mp.codigo = 'EFECTIVO'), 0)::text AS "efectivoVentas",
         coalesce((SELECT sum(p.monto_total) FROM venta_pago p JOIN metodo_pago mp ON mp.id = p.metodo_pago_id
                    WHERE p.turno_id = $1 AND NOT p.anulado AND mp.codigo = 'TARJETA'), 0)::text AS tarjeta,
         coalesce((SELECT sum(p.monto_total) FROM venta_pago p JOIN metodo_pago mp ON mp.id = p.metodo_pago_id
                    WHERE p.turno_id = $1 AND NOT p.anulado AND mp.codigo = 'TRANSFERENCIA'), 0)::text AS transferencia,
         coalesce((SELECT sum(monto) FROM movimiento_caja WHERE turno_id = $1 AND tipo = 'RETIRO'), 0)::text AS retiros,
         coalesce((SELECT sum(monto) FROM movimiento_caja WHERE turno_id = $1 AND tipo = 'INGRESO'), 0)::text AS ingresos,
         coalesce((SELECT sum(monto) FROM movimiento_caja WHERE turno_id = $1 AND tipo = 'REEMBOLSO'), 0)::text AS reembolsos`,
      [turnoId],
    );
    const fmt = (v: string) => money(v).toFixed(2);
    return {
      ventas: r.ventas,
      efectivoVentas: fmt(r.efectivoVentas),
      tarjeta: fmt(r.tarjeta),
      transferencia: fmt(r.transferencia),
      retiros: fmt(r.retiros),
      ingresos: fmt(r.ingresos),
      reembolsos: fmt(r.reembolsos),
      efectivoEsperado: efectivoEsperado({ fondoInicial, ...r }).toFixed(2),
    };
  }

  /** Valida denominaciones (activas, sin repetir) y devuelve el total. */
  private async totalizar(m: EntityManager, conteo: ConteoItemDto[]): Promise<Decimal> {
    const ids = conteo.map((c) => c.denominacionId);
    if (new Set(ids).size !== ids.length)
      throw new BusinessError('DENOMINACION_REPETIDA', 'Hay denominaciones repetidas', 422);
    const dens = ids.length
      ? await m.getRepository(Denominacion).findBy({ id: In(ids), activo: true })
      : [];
    if (dens.length !== ids.length)
      throw new BusinessError(
        'DENOMINACION_INVALIDA',
        'Alguna denominación no existe o está inactiva',
        422,
      );
    const valor = new Map(dens.map((d) => [d.id, d.valor]));
    return totalConteo(
      conteo.map((c) => ({ valor: valor.get(c.denominacionId)!, cantidad: c.cantidad })),
    );
  }

  private async guardarConteo(
    m: EntityManager,
    turnoId: number,
    momento: 'APERTURA' | 'CIERRE',
    conteo: ConteoItemDto[],
  ) {
    const filas = conteo.filter((c) => c.cantidad > 0);
    for (const c of filas)
      await m.query(
        `INSERT INTO turno_denominacion (turno_id, momento, denominacion_id, cantidad) VALUES ($1, $2, $3, $4)`,
        [turnoId, momento, c.denominacionId, c.cantidad],
      );
    if (momento === 'CIERRE' && !filas.length)
      // Conteo en cero: se deja una marca para saber que ya se registró.
      await m.query(
        `INSERT INTO turno_denominacion (turno_id, momento, denominacion_id, cantidad)
         SELECT $1, 'CIERRE', id, 0 FROM denominacion WHERE activo ORDER BY orden LIMIT 1`,
        [turnoId],
      );
  }

  private async tieneConteo(m: EntityManager, turnoId: number, momento: 'APERTURA' | 'CIERRE') {
    const [r] = await m.query(
      `SELECT EXISTS (SELECT 1 FROM turno_denominacion WHERE turno_id = $1 AND momento = $2) AS hay`,
      [turnoId, momento],
    );
    return r.hay as boolean;
  }

  private async totalGuardado(m: EntityManager, turnoId: number, momento: 'APERTURA' | 'CIERRE') {
    const [r] = await m.query(
      `SELECT coalesce(sum(n.valor * d.cantidad), 0)::text AS total
         FROM turno_denominacion d JOIN denominacion n ON n.id = d.denominacion_id
        WHERE d.turno_id = $1 AND d.momento = $2`,
      [turnoId, momento],
    );
    return money(r.total);
  }
}
