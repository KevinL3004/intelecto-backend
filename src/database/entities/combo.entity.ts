import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ID } from './base';
import { Colegio } from './colegio.entity';
import { Grado } from './grado.entity';
import { Libro } from './libro.entity';

@Entity('combo')
export class Combo {
  @PrimaryGeneratedColumn('identity', { type: 'bigint', generatedIdentity: 'ALWAYS' })
  id: number;
  @Column({ name: 'colegio_id', ...ID }) colegioId: number;
  @ManyToOne(() => Colegio) @JoinColumn({ name: 'colegio_id' }) colegio: Colegio;
  @Column({ name: 'grado_id', ...ID }) gradoId: number;
  @ManyToOne(() => Grado) @JoinColumn({ name: 'grado_id' }) grado: Grado;
  @Column() ciclo: number;
  @Column() nombre: string;
  @Column({ type: 'numeric', precision: 12, scale: 2 }) descuento: string;
  @Column({ default: true }) activo: boolean;
  @OneToMany(() => ComboLibro, (cl) => cl.combo) libros: ComboLibro[];
}

@Entity('combo_libro')
export class ComboLibro {
  @PrimaryColumn({ name: 'combo_id', ...ID }) comboId: number;
  @PrimaryColumn({ name: 'libro_id', ...ID }) libroId: number;
  @ManyToOne(() => Combo, (c) => c.libros, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'combo_id' })
  combo: Combo;
  @ManyToOne(() => Libro) @JoinColumn({ name: 'libro_id' }) libro: Libro;
  @Column() cantidad: number;
}
