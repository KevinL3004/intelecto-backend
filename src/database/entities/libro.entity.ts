import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ID } from './base';

@Entity('libro')
export class Libro {
  @PrimaryGeneratedColumn('identity', { type: 'bigint', generatedIdentity: 'ALWAYS' })
  id: number;
  @Column({ type: 'varchar', nullable: true }) isbn: string | null;
  @Column() titulo: string;
  @Column({ type: 'varchar', nullable: true }) editorial: string | null;
  @Column({ default: true }) activo: boolean;
  @CreateDateColumn({ name: 'creado_en', type: 'timestamptz' }) creadoEn: Date;
  @UpdateDateColumn({ name: 'actualizado_en', type: 'timestamptz' }) actualizadoEn: Date;
  @Column({ name: 'creado_por', ...ID, nullable: true }) creadoPor: number | null;
}
