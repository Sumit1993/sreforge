import {
  Injectable,
  OnModuleInit,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import * as promClient from 'prom-client';

@Injectable()
export class MetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly register: promClient.Registry;
  private readonly httpRequestDuration: promClient.Histogram;
  private readonly httpRequestsTotal: promClient.Counter;
  private readonly logger = new Logger(MetricsService.name);

  constructor() {
    this.register = new promClient.Registry();
    promClient.collectDefaultMetrics({ register: this.register });

    // Create HTTP request duration histogram
    this.httpRequestDuration = new promClient.Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'status'],
      buckets: [0.1, 0.5, 1, 2, 5],
      registers: [this.register],
    });

    // Create HTTP requests total counter
    this.httpRequestsTotal = new promClient.Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status'],
      registers: [this.register],
    });

    this.logger.log('Metrics service initialized for Prometheus scraping');
  }

  onModuleInit() {
    this.logger.log('Metrics endpoint available at /metrics');
  }

  onModuleDestroy() {
    // Clean up resources if needed
  }

  getMetrics(): Promise<string> {
    return this.register.metrics();
  }

  // Method to record HTTP request metrics
  recordHttpRequest(
    method: string,
    route: string,
    status: number,
    duration: number,
  ) {
    this.httpRequestDuration.observe({ method, route, status }, duration);
    this.httpRequestsTotal.inc({ method, route, status });
  }
}
