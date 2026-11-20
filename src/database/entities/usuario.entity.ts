import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ID } from './base';
import { Persona } from './persona.entity';
import { Colegio } from './colegio.entity';
import { Rol } from '../../common/roles';

@Entity('usuario')
export class Usuario {
  @PrimaryGeneratedColumn('identity', { type: 'bigint', generatedIdentity: 'ALWAYS' })
  id: number;
  @Column({ name: 'persona_id', ...ID }) personaId: number;
  @ManyToOne(() => Persona) @JoinColumn({ name: 'persona_id' }) persona: Persona;
  @Column() username: string;
  @Column({ name: 'password_hash', select: false }) passwordHash: string;
  @Column({ type: 'enum', enum: Rol, enumName: 'rol_usuario' }) rol: Rol;
  @Column({ name: 'colegio_id', ...ID, nullable: true }) colegioId: number | null;
  @ManyToOne(() => Colegio) @JoinColumn({ name: 'colegio_id' }) colegio: Colegio | null;
  @Column({ name: 'debe_cambiar_password' }) debeCambiarPassword: boolean;
  @Column({ name: 'intentos_fallidos' }) intentosFallidos: number;
  @Column({ name: 'bloqueado_hasta', type: 'timestamptz', nullable: true })
  bloqueadoHasta: Date | null;
  @Column() tema: 'light' | 'dark' | 'system';
  @Column({ name: 'ultimo_acceso', type: 'timestamptz', nullable: true }) ultimoAcceso: Date | null;
  @Column({ default: true }) activo: boolean;
  @CreateDateColumn({ name: 'creado_en', type: 'timestamptz' }) creadoEn: Date;
  @UpdateDateColumn({ name: 'actualizado_en', type: 'timestamptz' }) actualizadoEn: Date;
  @Column({ name: 'creado_por', ...ID, nullable: true }) creadoPor: number | null;
}
