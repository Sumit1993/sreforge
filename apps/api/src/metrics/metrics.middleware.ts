import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metricsService: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const start = Date.now();

    // Record metrics when response finishes
    res.on('finish', () => {
      const duration = (Date.now() - start) / 1000; // Convert to seconds
      this.metricsService.recordHttpRequest(
        req.method,
        req.route?.path || req.path,
        res.statusCode,
        duration,
      );
    });

    next();
  }
}
