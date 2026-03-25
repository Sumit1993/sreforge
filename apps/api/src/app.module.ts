import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { TodosModule } from './todos/todos.module';
import { MetricsModule } from './metrics/metrics.module';
import { MetricsMiddleware } from './metrics/metrics.middleware';
import { SecurityModule } from './security/security.module';
import { SecurityMiddleware } from './security/security.middleware';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    TodosModule,
    MetricsModule,
    SecurityModule,
    HealthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(MetricsMiddleware, SecurityMiddleware).forRoutes('*');
  }
}
