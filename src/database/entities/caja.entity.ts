import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { ID } from './base';
import { Colegio } from './colegio.entity';

@Entity('caja')
export class Caja {
  @PrimaryGeneratedColumn('identity', { type: 'bigint', generatedIdentity: 'ALWAYS' })
  id: number;
  @Column({ name: 'colegio_id', ...ID }) colegioId: number;
  @ManyToOne(() => Colegio) @JoinColumn({ name: 'colegio_id' }) colegio: Colegio;
  @Column() numero: number;
  @Column({ name: 'fondo_asignado', type: 'numeric', precision: 12, scale: 2 })
  fondoAsignado: string;
  @Column({ default: true }) activa: boolean;
}
