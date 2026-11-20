import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ID } from './base';
import { Caja } from './caja.entity';
import { Usuario } from './usuario.entity';

export type EstadoTurno = 'ABIERTO' | 'EN_CIERRE' | 'CERRADO' | 'VALIDADO' | 'OBSERVADO';
const NUM = { type: 'numeric' as const, precision: 12, scale: 2 };

@Entity('denominacion')
export class Denominacion {
  @PrimaryGeneratedColumn('identity', { type: 'bigint', generatedIdentity: 'ALWAYS' })
  id: number;
  @Column({ type: 'numeric', precision: 8, scale: 2 }) valor: string;
  @Column({ type: 'enum', enum: ['BILLETE', 'MONEDA'], enumName: 'tipo_denominacion' })
  tipo: 'BILLETE' | 'MONEDA';
  @Column() orden: number;
  @Column({ default: true }) activo: boolean;
}

@Entity('turno_caja')
export class TurnoCaja {
  @PrimaryGeneratedColumn('identity', { type: 'bigint', generatedIdentity: 'ALWAYS' })
  id: number;
  @Column({ name: 'caja_id', ...ID }) cajaId: number;
  @ManyToOne(() => Caja) @JoinColumn({ name: 'caja_id' }) caja: Caja;
  @Column({ name: 'usuario_id', ...ID }) usuarioId: number;
  @ManyToOne(() => Usuario) @JoinColumn({ name: 'usuario_id' }) usuario: Usuario;
  @Column({
    type: 'enum',
    enum: ['ABIERTO', 'EN_CIERRE', 'CERRADO', 'VALIDADO', 'OBSERVADO'],
    enumName: 'estado_turno',
  })
  estado: EstadoTurno;
  @Column({ name: 'fondo_inicial', ...NUM }) fondoInicial: string;
  @Column({ name: 'observacion_apertura', type: 'varchar', nullable: true })
  observacionApertura: string | null;
  @Column({ name: 'efectivo_esperado', ...NUM, nullable: true }) efectivoEsperado: string | null;
  @Column({ name: 'efectivo_contado', ...NUM, nullable: true }) efectivoContado: string | null;
  @Column({ name: 'diferencia_efectivo', ...NUM, nullable: true })
  diferenciaEfectivo: string | null;
  @Column({ name: 'tarjeta_esperado', ...NUM, nullable: true }) tarjetaEsperado: string | null;
  @Column({ name: 'transferencia_esperado', ...NUM, nullable: true })
  transferenciaEsperado: string | null;
  @Column({ name: 'observacion_cierre', type: 'varchar', nullable: true })
  observacionCierre: string | null;
  @Column() forzado: boolean;
  @Column({ name: 'cerrado_por', ...ID, nullable: true }) cerradoPor: number | null;
  @Column({ name: 'validado_por', ...ID, nullable: true }) validadoPor: number | null;
  @Column({ name: 'observacion_validacion', type: 'varchar', nullable: true })
  observacionValidacion: string | null;
  @Column({ name: 'abierto_en', type: 'timestamptz' }) abiertoEn: Date;
  @Column({ name: 'cerrado_en', type: 'timestamptz', nullable: true }) cerradoEn: Date | null;
  @Column({ name: 'validado_en', type: 'timestamptz', nullable: true }) validadoEn: Date | null;
}

@Entity('turno_denominacion')
export class TurnoDenominacion {
  @PrimaryColumn({ name: 'turno_id', ...ID }) turnoId: number;
  @PrimaryColumn({ type: 'enum', enum: ['APERTURA', 'CIERRE'], enumName: 'momento_conteo' })
  momento: 'APERTURA' | 'CIERRE';
  @PrimaryColumn({ name: 'denominacion_id', ...ID }) denominacionId: number;
  @Column() cantidad: number;
}

@Entity('movimiento_caja')
export class MovimientoCaja {
  @PrimaryGeneratedColumn('identity', { type: 'bigint', generatedIdentity: 'ALWAYS' })
  id: number;
  @Column({ name: 'turno_id', ...ID }) turnoId: number;
  @Column({ type: 'enum', enum: ['RETIRO', 'INGRESO', 'REEMBOLSO'], enumName: 'tipo_mov_caja' })
  tipo: 'RETIRO' | 'INGRESO' | 'REEMBOLSO';
  @Column(NUM) monto: string;
  @Column() motivo: string;
  @Column({ type: 'varchar', nullable: true }) referencia: string | null;
  @Column({ name: 'usuario_id', ...ID }) usuarioId: number;
  @Column({ type: 'timestamptz', default: () => 'now()' }) fecha: Date;
}
