import { Controller, Get } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { RedisCacheProvider } from '../cache/redis-cache.provider';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redisCacheProvider: RedisCacheProvider,
  ) {}

  @Get()
  async check() {
    let database: 'connected' | 'disconnected' = 'disconnected';
    let cache: 'connected' | 'disconnected' = 'disconnected';

    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
      database = 'connected';
    } catch {
      // database stays disconnected
    }

    try {
      const pong = await this.redisCacheProvider.ping();
      cache = pong ? 'connected' : 'disconnected';
    } catch {
      // cache stays disconnected
    }

    const status = database === 'connected' ? 'ok' : 'degraded';

    return {
      status,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      database,
      cache,
    };
  }
}
