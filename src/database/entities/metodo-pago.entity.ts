import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { ID } from './base';

@Entity('metodo_pago')
export class MetodoPago {
  @PrimaryGeneratedColumn('identity', { type: 'bigint', generatedIdentity: 'ALWAYS' })
  id: number;
  @Column() codigo: 'EFECTIVO' | 'TARJETA' | 'TRANSFERENCIA';
  @Column() nombre: string;
  @Column({ name: 'recargo_pct', type: 'numeric', precision: 5, scale: 2 }) recargoPct: string;
  @Column({ name: 'requiere_referencia' }) requiereReferencia: boolean;
  @Column({ default: true }) activo: boolean;
  @UpdateDateColumn({ name: 'actualizado_en', type: 'timestamptz' }) actualizadoEn: Date;
  @Column({ name: 'actualizado_por', ...ID, nullable: true }) actualizadoPor: number | null;
}
