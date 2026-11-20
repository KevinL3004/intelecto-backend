import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { Public } from '../../common/decorators';
import { SkipThrottle } from '@nestjs/throttler';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly ds: DataSource) {}

  /** Render lo usa como health check (y sirve para el ping que evita que se duerma). */
  @Public()
  @SkipThrottle()
  @Get()
  async check() {
    let db = 'ok';
    try {
      await this.ds.query('SELECT 1');
    } catch {
      db = 'error';
    }
    return { status: db === 'ok' ? 'ok' : 'degradado', db, time: new Date().toISOString() };
  }
}
