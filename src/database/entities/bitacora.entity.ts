import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { ID } from './base';

@Entity('bitacora')
export class Bitacora {
  @PrimaryGeneratedColumn('identity', { type: 'bigint', generatedIdentity: 'ALWAYS' })
  id: number;
  @Column({ name: 'usuario_id', ...ID, nullable: true }) usuarioId: number | null;
  @Column() accion: string;
  @Column() entidad: string;
  @Column({ name: 'entidad_id', type: 'varchar', nullable: true }) entidadId: string | null;
  @Column({ type: 'jsonb', nullable: true }) antes: unknown;
  @Column({ type: 'jsonb', nullable: true }) despues: unknown;
  @Column({ type: 'varchar', nullable: true }) ip: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) fecha: Date;
}
