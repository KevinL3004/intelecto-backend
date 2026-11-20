import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ID } from './base';
import { Libro } from './libro.entity';

@Entity('precio_libro')
export class PrecioLibro {
  @PrimaryGeneratedColumn('identity', { type: 'bigint', generatedIdentity: 'ALWAYS' })
  id: number;
  @Column({ name: 'colegio_id', ...ID }) colegioId: number;
  @Column({ name: 'libro_id', ...ID }) libroId: number;
  @ManyToOne(() => Libro) @JoinColumn({ name: 'libro_id' }) libro: Libro;
  @Column() ciclo: number;
  @Column({ type: 'numeric', precision: 12, scale: 2 }) precio: string;
  @UpdateDateColumn({ name: 'actualizado_en', type: 'timestamptz' }) actualizadoEn: Date;
  @Column({ name: 'actualizado_por', ...ID, nullable: true }) actualizadoPor: number | null;
}
