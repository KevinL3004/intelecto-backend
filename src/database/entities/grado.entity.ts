import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('grado')
export class Grado {
  @PrimaryGeneratedColumn('identity', { type: 'bigint', generatedIdentity: 'ALWAYS' })
  id: number;
  @Column() nombre: string;
  @Column() nivel: string;
  @Column() orden: number;
  @Column({ default: true }) activo: boolean;
}
