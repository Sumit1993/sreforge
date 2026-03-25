import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TodosController } from './todos.controller';
import { TodosService } from './todos.service';

@Module({
  imports: [
    HttpModule.register({
      timeout: 5000,
      maxRedirects: 3,
    }),
  ],
  controllers: [TodosController],
  providers: [TodosService],
})
export class TodosModule {}
