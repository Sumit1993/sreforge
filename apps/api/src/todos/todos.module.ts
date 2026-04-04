import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TodosController } from './todos.controller';
import { TodosService } from './todos.service';
import { PrismaTodoRepository } from './adapters/prisma-todo.repository';
import { RedisCacheProvider } from '../cache/redis-cache.provider';

@Module({
  imports: [
    // BUG #4: HttpModule timeout (5000ms) mismatches with SERVICE_TIMEOUT (3000ms)
    // Kept here even though we no longer use HttpModule for data fetching,
    // to preserve the timeout mismatch bug visibility.
    HttpModule.register({
      timeout: 5000,
      maxRedirects: 3,
    }),
  ],
  controllers: [TodosController],
  providers: [TodosService, PrismaTodoRepository, RedisCacheProvider],
})
export class TodosModule {}
