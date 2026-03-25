import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import {
  WinstonModule,
  utilities as nestWinstonModuleUtilities,
} from 'nest-winston';
import * as winston from 'winston';
import axios from 'axios';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import TransportStream = require('winston-transport');

// Custom Loki transport for Winston
class LokiTransport extends TransportStream {
  private url: string;
  private auth: string;
  private labels: Record<string, string>;
  private buffer: any[] = [];
  private readonly FLUSH_INTERVAL_MS = 5000; // 5 seconds

  constructor(opts?: any) {
    super(opts);
    this.url = opts?.url || '';
    this.auth = opts?.auth || '';
    this.labels = opts?.labels || { app: 'todo-app-api' };
  }

  log(info: any, callback: () => void) {
    setImmediate(() => {
      this.emit('logged', info);
    });

    // Add log to buffer
    this.buffer.push({
      ts: new Date().toISOString(),
      line: JSON.stringify({
        level: info.level,
        message: info.message,
        ...info.meta,
      }),
    });

    // If buffer gets too large, flush immediately
    if (this.buffer.length >= 100) {
      this.flush();
    }

    callback();
  }

  async flush() {
    if (this.buffer.length === 0) return;

    const logs = [...this.buffer];
    this.buffer = [];

    try {
      const body = {
        streams: [
          {
            stream: this.labels,
            values: logs.map((log) => [log.ts, log.line]),
          },
        ],
      };

      await axios.post(this.url, body, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.auth,
        },
      });
    } catch (error) {
      console.error('Error sending logs to Loki:', error);
      // Put logs back in buffer to retry on next flush
      this.buffer = [...logs, ...this.buffer];
    }
  }
}

async function bootstrap() {
  // Configure transports array
  const transports: winston.transport[] = [
    // Console transport for development
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp(),
        nestWinstonModuleUtilities.format.nestLike('TodoApp', {
          prettyPrint: true,
          colors: true,
        }),
      ),
    }),
  ];

  // Add file transport for local development logs
  if (process.env.NODE_ENV !== 'production') {
    transports.push(
      new winston.transports.File({
        filename: 'logs/application.log',
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json(),
        ),
        level: 'info',
      }),
    );
  }

  // Add Grafana Loki transport if configured
  if (process.env.GRAFANA_LOKI_URL && process.env.GRAFANA_API_KEY) {
    transports.push(
      new LokiTransport({
        url: process.env.GRAFANA_LOKI_URL,
        auth: `Bearer ${process.env.GRAFANA_API_KEY}`,
        labels: {
          app: 'todo-app-api',
          environment: process.env.NODE_ENV || 'development',
        },
        level: 'info',
      }),
    );
  }

  // Configure application-wide Winston logger
  const logger = WinstonModule.createLogger({
    transports,
  });

  const app = await NestFactory.create(AppModule, {
    logger: logger,
  });

  // Enable CORS for frontend access with enhanced security in production
  if (process.env.NODE_ENV === 'production') {
    // In production, restrict to specific origins
    app.enableCors({
      origin: process.env.FRONTEND_URL || 'https://todo-app.vercel.app',
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
      credentials: true,
      maxAge: 86400, // 24 hours
    });

    // Set global prefix in production cause on local niginx takes care of prefix
    app.setGlobalPrefix('api');
  } else {
    // In development, allow all origins
    app.enableCors({
      origin: true,
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
      credentials: true,
    });
  }

  // Enable validation for all endpoints
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: false, // Handle type conversion manually in service layer
  }));

  await app.listen(process.env.PORT || 3000);
}
bootstrap();
