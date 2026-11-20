import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ID } from './base';
import { Libro } from './libro.entity';

export type TipoMovInv =
  | 'INGRESO'
  | 'AJUSTE'
  | 'VENTA_ENTREGA'
  | 'RESERVA'
  | 'LIBERA'
  | 'TRASLADO_SALIDA'
  | 'TRASLADO_ENTRADA'
  | 'ANULACION'
  | 'PROVEEDOR_ENTRADA';

@Entity('inventario')
export class Inventario {
  @PrimaryColumn({ name: 'colegio_id', ...ID }) colegioId: number;
  @PrimaryColumn({ name: 'libro_id', ...ID }) libroId: number;
  @Column() existencia: number;
  @Column() reservado: number;
  @Column() version: number;
  @UpdateDateColumn({ name: 'actualizado_en', type: 'timestamptz' }) actualizadoEn: Date;
}

@Entity('movimiento_inventario')
export class MovimientoInventario {
  @PrimaryGeneratedColumn('identity', { type: 'bigint', generatedIdentity: 'ALWAYS' })
  id: number;
  @Column({ name: 'colegio_id', ...ID }) colegioId: number;
  @Column({ name: 'libro_id', ...ID }) libroId: number;
  @ManyToOne(() => Libro) @JoinColumn({ name: 'libro_id' }) libro: Libro;
  @Column({
    type: 'enum',
    enum: [
      'INGRESO',
      'AJUSTE',
      'VENTA_ENTREGA',
      'RESERVA',
      'LIBERA',
      'TRASLADO_SALIDA',
      'TRASLADO_ENTRADA',
      'ANULACION',
      'PROVEEDOR_ENTRADA',
    ],
    enumName: 'tipo_mov_inv',
  })
  tipo: TipoMovInv;
  @Column() cantidad: number;
  @Column({ type: 'varchar', nullable: true }) referencia: string | null;
  @Column({ type: 'varchar', nullable: true }) motivo: string | null;
  @Column({ name: 'usuario_id', ...ID, nullable: true }) usuarioId: number | null;
  @CreateDateColumn({ name: 'fecha', type: 'timestamptz' }) fecha: Date;
}
