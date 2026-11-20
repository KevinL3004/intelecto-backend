import Decimal from 'decimal.js';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { Combo, ComboLibro, Libro, PrecioLibro } from '../../database/entities';
import { toMoneyString } from '../../common/utils/money';
import { cicloActual } from '../../common/utils/alcance';
import { BusinessError } from '../../common/errors';
import { BitacoraService } from '../bitacora/bitacora.service';
import { calcularTotalCombo } from './combo-total';
import { ComboLibroDto, CrearComboDto, EditarComboDto } from './dto/combo.dto';

@Injectable()
export class CombosService {
  constructor(
    private readonly ds: DataSource,
    private readonly bitacora: BitacoraService,
  ) {}

  async listar(colegioId: number, ciclo?: number, gradoId?: number) {
    const c = ciclo ?? (await cicloActual(this.ds.manager));
    const combos = await this.ds.getRepository(Combo).find({
      where: { colegioId, ciclo: c, ...(gradoId ? { gradoId } : {}) },
      relations: { grado: true, libros: { libro: true } },
      order: { grado: { orden: 'ASC' } },
    });
    const precios = await this.preciosDe(this.ds.manager, colegioId, c);
    return { colegioId, ciclo: c, items: combos.map((x) => this.armar(x, precios)) };
  }

  async obtener(id: number, m: EntityManager = this.ds.manager) {
    const combo = await m.getRepository(Combo).findOne({
      where: { id },
      relations: { grado: true, colegio: true, libros: { libro: true } },
    });
    if (!combo) throw new NotFoundException('Combo no encontrado');
    const precios = await this.preciosDe(m, combo.colegioId, combo.ciclo);
    return this.armar(combo, precios);
  }

  async crear(dto: CrearComboDto, usuarioId: number, ip: string) {
    return this.ds.transaction(async (m) => {
      const ciclo = dto.ciclo ?? (await cicloActual(m));
      await this.validarLibros(m, dto.libros);
      const { id } = await m.getRepository(Combo).save(
        m.getRepository(Combo).create({
          colegioId: dto.colegioId,
          gradoId: dto.gradoId,
          ciclo,
          nombre: dto.nombre.trim(),
          descuento: toMoneyString(dto.descuento ?? 0),
        }),
      );
      await this.reemplazarLibros(m, id, dto.libros);
      const despues = await this.obtener(id, m);
      this.validarDescuento(despues);
      await this.bitacora.registrar(
        { usuarioId, accion: 'CREAR', entidad: 'combo', entidadId: id, despues, ip },
        m,
      );
      return despues;
    });
  }

  async editar(id: number, dto: EditarComboDto, usuarioId: number, ip: string) {
    return this.ds.transaction(async (m) => {
      const antes = await this.obtener(id, m);
      const { libros, ...campos } = dto;
      const cambios: Partial<Combo> = { ...campos };
      if (campos.nombre) cambios.nombre = campos.nombre.trim();
      if (campos.descuento !== undefined) cambios.descuento = toMoneyString(campos.descuento);
      if (Object.keys(cambios).length) await m.getRepository(Combo).update(id, cambios);
      if (libros) {
        await this.validarLibros(m, libros);
        await this.reemplazarLibros(m, id, libros);
      }
      const despues = await this.obtener(id, m);
      this.validarDescuento(despues);
      await this.bitacora.registrar(
        { usuarioId, accion: 'EDITAR', entidad: 'combo', entidadId: id, antes, despues, ip },
        m,
      );
      return despues;
    });
  }

  async eliminar(id: number, usuarioId: number, ip: string) {
    const antes = await this.obtener(id);
    await this.ds.getRepository(Combo).delete(id);
    await this.bitacora.registrar({
      usuarioId,
      accion: 'ELIMINADO',
      entidad: 'combo',
      entidadId: id,
      antes,
      ip,
    });
    return { resultado: 'ELIMINADO' as const };
  }

  // ---------- auxiliares ----------

  private async preciosDe(m: EntityManager, colegioId: number, ciclo: number) {
    const filas = await m.getRepository(PrecioLibro).findBy({ colegioId, ciclo });
    return new Map(filas.map((p) => [p.libroId, p.precio]));
  }

  private armar(combo: Combo, precios: Map<number, string>) {
    const libros = (combo.libros ?? [])
      .map((cl) => ({
        libroId: cl.libroId,
        titulo: cl.libro?.titulo,
        isbn: cl.libro?.isbn ?? null,
        cantidad: cl.cantidad,
        precio: precios.get(cl.libroId) ?? null,
      }))
      .sort((a, b) => (a.titulo ?? '').localeCompare(b.titulo ?? ''));
    const { libros: _omit, ...resto } = combo;
    void _omit;
    return { ...resto, libros, ...calcularTotalCombo(libros, combo.descuento) };
  }

  private async validarLibros(m: EntityManager, libros: ComboLibroDto[]) {
    const ids = libros.map((l) => l.libroId);
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException('Hay libros repetidos en el combo');
    const activos = await m.getRepository(Libro).countBy({ id: In(ids), activo: true });
    if (activos !== ids.length)
      throw new BadRequestException('Algún libro no existe o está inactivo');
  }

  private async reemplazarLibros(m: EntityManager, comboId: number, libros: ComboLibroDto[]) {
    const repo = m.getRepository(ComboLibro);
    await repo.delete({ comboId });
    await repo.insert(libros.map((l) => ({ comboId, libroId: l.libroId, cantidad: l.cantidad })));
  }

  /** El descuento no puede superar la suma de los libros (cuando todos tienen precio). */
  private validarDescuento(c: { completo: boolean; descuento: string; subtotal: string }) {
    if (c.completo && new Decimal(c.descuento).gt(c.subtotal))
      throw new BusinessError(
        'DESCUENTO_EXCEDE',
        `El descuento (Q${c.descuento}) supera el valor de los libros (Q${c.subtotal})`,
        422,
      );
  }
}
