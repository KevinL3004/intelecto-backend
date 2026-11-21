import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { paginate } from '../../common/dto/pagination.dto';
import { coincide, patron } from '../../common/utils/busqueda';
import { BitacoraService } from '../bitacora/bitacora.service';
import {
  CrearAlumnoDto,
  EditarAlumnoDto,
  FiltroAlumnosDto,
  Parentesco,
  VincularDto,
} from './dto/alumno.dto';
import { filas } from '../../common/utils/filas';

const NOMBRE = `trim(a.nombres || ' ' || a.apellidos)`;

/**
 * Alumnos y sus encargados (padre, madre u otro). Son datos de menores: solo nombre, colegio
 * y grado, y el cajero únicamente ve los alumnos del cliente que está atendiendo.
 */
@Injectable()
export class AlumnosService {
  constructor(
    private readonly ds: DataSource,
    private readonly bitacora: BitacoraService,
  ) {}

  async listar(f: FiltroAlumnosDto) {
    const params: unknown[] = [];
    const p = (v: unknown) => (params.push(v), `$${params.length}`);
    const where: string[] = [];
    if (f.activo) where.push(`a.activo = ${p(f.activo === 'true')}`);
    if (f.colegioId) where.push(`a.colegio_id = ${p(f.colegioId)}`);
    if (f.gradoId) where.push(`a.grado_id = ${p(f.gradoId)}`);
    if (f.q) {
      const q = p(patron(f.q));
      // También por el nombre del encargado: "¿qué hijos tiene la señora López?"
      where.push(`(${coincide(NOMBRE, q)} OR EXISTS (
        SELECT 1 FROM persona_alumno pa JOIN persona pe ON pe.id = pa.persona_id
         WHERE pa.alumno_id = a.id AND ${coincide("pe.nombres || ' ' || pe.apellidos", q)}))`);
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [{ total }] = await this.ds.query(
      `SELECT count(*)::int AS total FROM alumno a ${w}`,
      params,
    );
    const data = await this.ds.query(
      `${this.select()} ${w} ORDER BY a.apellidos, a.nombres
        LIMIT ${p(f.limit)} OFFSET ${p((f.page - 1) * f.limit)}`,
      params,
    );
    return paginate(data, total, f);
  }

  /** Alumnos de un encargado (lo que ve el cajero al elegir al cliente). */
  async deEncargado(personaId: number) {
    return this.ds.query(
      `${this.select()} JOIN persona_alumno px ON px.alumno_id = a.id AND px.persona_id = $1
        WHERE a.activo ORDER BY a.nombres`,
      [personaId],
    );
  }

  async obtener(id: number) {
    const [a] = await this.ds.query(`${this.select()} WHERE a.id = $1`, [id]);
    if (!a) throw new NotFoundException('Alumno no encontrado');
    const compras = await this.ds.query(
      `SELECT v.id AS "ventaId", v.codigo, v.fecha, v.estado_pago AS "estadoPago", g.nombre AS grado,
              va.licencia, co.nombre AS colegio,
              coalesce((SELECT sum(d.subtotal) FROM venta_detalle d WHERE d.venta_alumno_id = va.id), 0)
                - va.descuento AS total
         FROM venta_alumno va JOIN venta v ON v.id = va.venta_id JOIN colegio co ON co.id = v.colegio_id
         LEFT JOIN grado g ON g.id = va.grado_id
        WHERE va.alumno_id = $1 ORDER BY v.fecha DESC LIMIT 50`,
      [id],
    );
    return { ...a, compras };
  }

  async crear(dto: CrearAlumnoDto, usuarioId: number, ip: string) {
    const id = await this.ds.transaction(async (m) => {
      const [a] = await m.query(
        `INSERT INTO alumno (nombres, apellidos, colegio_id, grado_id, creado_por)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [dto.nombres, dto.apellidos ?? '', dto.colegioId ?? null, dto.gradoId ?? null, usuarioId],
      );
      if (dto.personaId) await this.vincularEn(m, a.id, dto.personaId, dto.parentesco);
      await this.bitacora.registrar(
        { usuarioId, accion: 'CREAR', entidad: 'alumno', entidadId: a.id, despues: dto, ip },
        m,
      );
      return a.id as number;
    });
    return this.obtener(id);
  }

  async editar(id: number, dto: EditarAlumnoDto, usuarioId: number, ip: string) {
    const antes = await this.obtener(id);
    const campos: [string, unknown][] = (
      [
        ['nombres', dto.nombres],
        ['apellidos', dto.apellidos],
        ['colegio_id', dto.colegioId],
        ['grado_id', dto.gradoId],
        ['activo', dto.activo],
      ] as [string, unknown][]
    ).filter(([, v]) => v !== undefined);
    if (campos.length)
      await this.ds.query(
        `UPDATE alumno SET ${campos.map(([c], i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`,
        [id, ...campos.map(([, v]) => v)],
      );
    await this.bitacora.registrar({
      usuarioId,
      accion: 'EDITAR',
      entidad: 'alumno',
      entidadId: id,
      antes: {
        nombre: antes.nombre,
        colegioId: antes.colegioId,
        gradoId: antes.gradoId,
        activo: antes.activo,
      },
      despues: dto,
      ip,
    });
    return this.obtener(id);
  }

  async vincular(id: number, dto: VincularDto, usuarioId: number, ip: string) {
    await this.obtener(id);
    await this.vincularEn(this.ds.manager, id, dto.personaId, dto.parentesco, true);
    await this.bitacora.registrar({
      usuarioId,
      accion: 'VINCULAR',
      entidad: 'alumno',
      entidadId: id,
      despues: dto,
      ip,
    });
    return this.obtener(id);
  }

  async desvincular(id: number, personaId: number, usuarioId: number, ip: string) {
    const r = filas(
      await this.ds.query(
        `DELETE FROM persona_alumno WHERE alumno_id = $1 AND persona_id = $2 RETURNING persona_id`,
        [id, personaId],
      ),
    );
    if (!r.length) throw new NotFoundException('Ese encargado no está vinculado al alumno');
    await this.bitacora.registrar({
      usuarioId,
      accion: 'DESVINCULAR',
      entidad: 'alumno',
      entidadId: id,
      antes: { personaId },
      ip,
    });
    return this.obtener(id);
  }

  /** Vincula alumno ↔ encargado. Con `actualizar`, cambia el parentesco si ya existía. */
  async vincularEn(
    m: Pick<EntityManager, 'query'>,
    alumnoId: number,
    personaId: number,
    parentesco: Parentesco = 'ENCARGADO',
    actualizar = false,
  ) {
    const [p] = await m.query(`SELECT id FROM persona WHERE id = $1 AND activo`, [personaId]);
    if (!p) throw new BadRequestException('Encargado no encontrado');
    await m.query(
      `INSERT INTO persona_alumno (persona_id, alumno_id, parentesco) VALUES ($1, $2, $3)
       ON CONFLICT (persona_id, alumno_id) DO ${actualizar ? 'UPDATE SET parentesco = EXCLUDED.parentesco' : 'NOTHING'}`,
      [personaId, alumnoId, parentesco],
    );
  }

  private select() {
    return `SELECT a.id, a.nombres, a.apellidos, ${NOMBRE} AS nombre, a.activo,
                   a.colegio_id AS "colegioId", co.nombre AS colegio, a.grado_id AS "gradoId", g.nombre AS grado,
                   coalesce((SELECT json_agg(json_build_object(
                              'personaId', pe.id, 'nombre', trim(pe.nombres || ' ' || pe.apellidos),
                              'nit', pe.nit, 'telefono', pe.telefono, 'correo', pe.correo,
                              'parentesco', pa.parentesco) ORDER BY pe.nombres)
                               FROM persona_alumno pa JOIN persona pe ON pe.id = pa.persona_id
                              WHERE pa.alumno_id = a.id), '[]') AS encargados
              FROM alumno a LEFT JOIN colegio co ON co.id = a.colegio_id LEFT JOIN grado g ON g.id = a.grado_id`;
  }
}
