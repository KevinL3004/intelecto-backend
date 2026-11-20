import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { bool } from '../config/env.validation';
import { types } from 'pg';
import * as E from './entities';

// BIGINT y COUNT(*) llegan como number (ids < 2^53). NUMERIC sigue como string (dinero).
types.setTypeParser(20, (v: string) => parseInt(v, 10));

export const ENTITIES = Object.values(E).filter((v) => typeof v === 'function');

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.getOrThrow<string>('DATABASE_URL'),
        ssl: bool(config.get('DATABASE_SSL')) ? { rejectUnauthorized: false } : false,
        entities: ENTITIES,
        synchronize: false, // el esquema lo manda db/sql (scripts SQL)
        logging: config.get('NODE_ENV') === 'development' ? ['error', 'warn'] : ['error'],
        extra: { max: 10 },
      }),
    }),
  ],
})
export class DatabaseModule {}
