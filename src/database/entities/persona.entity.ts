import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ID } from './base';

@Entity('persona')
export class Persona {
  @PrimaryGeneratedColumn('identity', { type: 'bigint', generatedIdentity: 'ALWAYS' })
  id: number;
  @Column() nombres: string;
  @Column() apellidos: string;
  @Column() nit: string;
  @Column({ type: 'varchar', nullable: true }) dpi: string | null;
  @Column({ type: 'varchar', nullable: true }) telefono: string | null;
  @Column({ type: 'varchar', nullable: true }) correo: string | null;
  @Column({ default: true }) activo: boolean;
  @CreateDateColumn({ name: 'creado_en', type: 'timestamptz' }) creadoEn: Date;
  @UpdateDateColumn({ name: 'actualizado_en', type: 'timestamptz' }) actualizadoEn: Date;
  @Column({ name: 'creado_por', ...ID, nullable: true }) creadoPor: number | null;
}
