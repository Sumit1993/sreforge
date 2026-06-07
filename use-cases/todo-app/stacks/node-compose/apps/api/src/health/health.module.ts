import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { RedisCacheProvider } from '../cache/redis-cache.provider';

@Module({
  controllers: [HealthController],
  providers: [RedisCacheProvider],
})
export class HealthModule {}
