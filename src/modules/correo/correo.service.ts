import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import nodemailer, { type Transporter } from 'nodemailer';
import { bool } from '../../config/env.validation';
import { consultarVenta, datosEmpresa } from '../ventas/consulta-venta';
import { plantillaComprobante } from './plantilla-comprobante';
import { filas } from '../../common/utils/filas';

export type TipoCorreo = 'COMPROBANTE' | 'ENTREGA_COMPLETA';
interface Pendiente {
  id: number;
  ventaId: number;
  destinatario: string;
  intentos: number;
  tipo: TipoCorreo;
}

/** Espera antes de cada reintento (minutos): 1, 5, 15, 60, 180. Al 6.º fallo queda FALLIDO. */
const ESPERAS_MIN = [1, 5, 15, 60, 180];
const MAX_INTENTOS = ESPERAS_MIN.length + 1;
const CADA_MS = 15_000;
const LOTE = 10;

/**
 * Correo saliente con bandeja (tabla correo_saliente): la venta solo encola en su misma
 * transacción y un proceso en segundo plano envía, con reintentos. Si el proveedor de correo
 * falla, la venta no se ve afectada. El contenido no se guarda: se arma al enviar.
 */
@Injectable()
export class CorreoService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Correo');
  private transporte: Transporter | null = null;
  private timer?: NodeJS.Timeout;
  private ocupado = false;

  constructor(
    private readonly ds: DataSource,
    private readonly config: ConfigService,
  ) {}

  get habilitado() {
    return bool(this.config.get<string>('CORREO_HABILITADO'));
  }

  onModuleInit() {
    if (!this.habilitado) {
      this.log.log('Envío de correos deshabilitado (CORREO_HABILITADO=false)');
      return;
    }
    const puerto = Number(this.config.get('SMTP_PORT') ?? 587);
    const seguro = puerto === 465;
    const tls = this.config.get<string>('SMTP_REQUIERE_TLS') !== 'false';
    this.transporte = nodemailer.createTransport({
      host: this.config.get<string>('SMTP_HOST'),
      port: puerto,
      secure: seguro, // 465: TLS desde el inicio; 587: STARTTLS obligatorio (requireTLS)
      requireTLS: !seguro && tls,
      ignoreTLS: !tls, // solo para pruebas locales; prohibido en producción (env.validation)
      auth: {
        user: this.config.get<string>('SMTP_USUARIO'),
        pass: this.config.get<string>('SMTP_PASSWORD'),
      },
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
      pool: true,
      maxConnections: 2,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
    this.timer = setInterval(() => void this.procesar(), CADA_MS);
    this.timer.unref();
    this.log.log(`Envío de correos habilitado (${this.config.get('SMTP_HOST')}:${puerto})`);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
    this.transporte?.close();
  }

  /** Encola el comprobante dentro de la transacción de quien llama. No hace nada si está deshabilitado. */
  async encolarComprobante(
    m: EntityManager,
    ventaId: number,
    destinatario: string,
    usuarioId: number | null,
    tipo: TipoCorreo = 'COMPROBANTE',
  ) {
    if (!this.habilitado) return false;
    await m.query(
      `INSERT INTO correo_saliente (venta_id, tipo, destinatario, creado_por)
       VALUES ($1, $4, $2, $3)`,
      [ventaId, destinatario.trim().toLowerCase(), usuarioId, tipo],
    );
    // Intenta enviar pronto, sin esperar al siguiente ciclo.
    setTimeout(() => void this.procesar(), 500).unref();
    return true;
  }

  /** Toma un lote de correos pendientes y los envía. Seguro con varias instancias (SKIP LOCKED). */
  async procesar() {
    if (!this.transporte || this.ocupado) return;
    this.ocupado = true;
    try {
      // "Reserva" el lote: si el proceso muere a mitad, se reintentan tras 10 min.
      const lote = filas<Pendiente>(
        await this.ds.query(
          `UPDATE correo_saliente SET intentos = intentos + 1, proximo_intento = now() + interval '10 minutes'
            WHERE id IN (SELECT id FROM correo_saliente
                          WHERE estado = 'PENDIENTE' AND proximo_intento <= now()
                          ORDER BY id LIMIT ${LOTE} FOR UPDATE SKIP LOCKED)
            RETURNING id, venta_id AS "ventaId", destinatario, intentos, tipo`,
        ),
      );
      for (const c of lote) await this.enviarUno(c);
    } catch (e) {
      this.log.error(`Error procesando la bandeja de correo: ${(e as Error).message}`);
    } finally {
      this.ocupado = false;
    }
  }

  private async enviarUno(c: Pendiente) {
    try {
      const venta = await consultarVenta(this.ds, c.ventaId);
      if (!venta) throw Object.assign(new Error('La venta ya no existe'), { permanente: true });
      const empresa = await datosEmpresa(this.ds);
      const { asunto, html, texto } = plantillaComprobante(venta, empresa, c.tipo);
      const responder = this.config.get<string>('CORREO_RESPONDER_A');
      await this.transporte!.sendMail({
        from: this.config.get<string>('CORREO_REMITENTE'),
        ...(responder ? { replyTo: responder } : {}),
        to: c.destinatario,
        subject: asunto,
        text: texto,
        html,
      });
      await this.ds.query(
        `UPDATE correo_saliente SET estado = 'ENVIADO', enviado_en = now(), ultimo_error = NULL WHERE id = $1`,
        [c.id],
      );
    } catch (e) {
      const err = e as Error & { responseCode?: number; permanente?: boolean };
      // 5xx = rechazo definitivo (p. ej. buzón inexistente): no tiene sentido reintentar.
      const definitivo =
        err.permanente || (err.responseCode !== undefined && err.responseCode >= 500);
      const agotado = c.intentos >= MAX_INTENTOS;
      const espera = ESPERAS_MIN[Math.min(c.intentos - 1, ESPERAS_MIN.length - 1)];
      await this.ds.query(
        `UPDATE correo_saliente
            SET estado = $2, ultimo_error = $3,
                proximo_intento = now() + ($4 || ' minutes')::interval
          WHERE id = $1`,
        [c.id, definitivo || agotado ? 'FALLIDO' : 'PENDIENTE', limpiar(err.message), espera],
      );
      // En el log no va el destinatario (dato personal), solo el id.
      this.log.warn(`Correo ${c.id} no enviado (intento ${c.intentos}): ${limpiar(err.message)}`);
    }
  }
}

/** Mensaje de error sin saltos de línea y acotado (no debería traer secretos; por si acaso, se corta). */
const limpiar = (s: string) =>
  String(s ?? 'Error')
    .replace(/\s+/g, ' ')
    .slice(0, 250);
