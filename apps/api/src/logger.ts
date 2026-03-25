import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import { randomUUID } from 'node:crypto';

// Custom format for structured logging with enhanced context
const structuredFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    const logEntry: any = {
      timestamp,
      level,
      message,
      service: 'todo-app-api',
      environment: process.env.NODE_ENV || 'development',
      pid: process.pid,
      correlationId: meta.correlationId || 'unknown',
      ...meta,
    };

    // Add stack trace for errors
    if (stack) {
      logEntry.stack = stack;
      logEntry.errorType = 'exception';
    }

    // Add memory stats for performance monitoring
    if (level === 'warn' || level === 'error') {
      const memUsage = process.memoryUsage();
      logEntry.memoryUsage = {
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        external: Math.round(memUsage.external / 1024 / 1024),
      };
    }

    return JSON.stringify(logEntry);
  }),
);

// Console format for development readability
const consoleFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.colorize(),
  winston.format.printf(
    ({ timestamp, level, message, correlationId, ...meta }) => {
      const correlation =
        typeof correlationId === 'string'
          ? `[${correlationId.slice(0, 8)}]`
          : '';
      const metaStr =
        Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
      return `${timestamp} ${level}: ${correlation} ${message}${metaStr}`;
    },
  ),
);

export const logger = WinstonModule.createLogger({
  transports: [
    new winston.transports.Console({
      format:
        process.env.NODE_ENV === 'production'
          ? structuredFormat
          : consoleFormat,
    }),
    // File transport for persistent structured logs
    new winston.transports.File({
      filename: 'logs/application.log',
      format: structuredFormat,
      level: 'info',
    }),
    // Separate error log file
    new winston.transports.File({
      filename: 'logs/error.log',
      format: structuredFormat,
      level: 'error',
    }),
  ],
});

// Utility function to create correlation ID for request tracing
export function generateCorrelationId(): string {
  return randomUUID();
}

// Enhanced logging utility with context
export class ContextLogger {
  private correlationId: string;
  private context: string;

  constructor(context: string, correlationId?: string) {
    this.context = context;
    this.correlationId = correlationId || generateCorrelationId();
  }

  private formatMessage(message: string, meta: any = {}) {
    return {
      message,
      context: this.context,
      correlationId: this.correlationId,
      ...meta,
    };
  }

  log(message: string, meta?: any) {
    logger.log(this.formatMessage(message, meta));
  }

  error(message: string, error?: Error, meta?: any) {
    const errorMeta = error
      ? {
          errorName: error.name,
          errorMessage: error.message,
          stack: error.stack,
          ...meta,
        }
      : meta;

    logger.error(this.formatMessage(message, errorMeta));
  }

  warn(message: string, meta?: any) {
    logger.warn(this.formatMessage(message, meta));
  }

  debug(message: string, meta?: any) {
    if (logger && typeof logger.debug === 'function') {
      logger.debug(this.formatMessage(message, meta));
    }
  }

  // Log performance metrics
  logPerformance(operation: string, duration: number, meta?: any) {
    this.log(`Performance: ${operation}`, {
      operation,
      duration,
      performanceType: 'timing',
      ...meta,
    });
  }

  // Log database operations (for future use)
  logDatabaseOperation(
    operation: string,
    table: string,
    duration?: number,
    meta?: any,
  ) {
    this.log(`Database: ${operation} on ${table}`, {
      operation,
      table,
      duration,
      operationType: 'database',
      ...meta,
    });
  }
}
