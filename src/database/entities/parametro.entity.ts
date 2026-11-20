import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('parametro')
export class Parametro {
  @PrimaryColumn() clave: string;
  @Column() valor: string;
  @Column({ type: 'varchar', nullable: true }) descripcion: string | null;
  @UpdateDateColumn({ name: 'actualizado_en', type: 'timestamptz' }) actualizadoEn: Date;
}
