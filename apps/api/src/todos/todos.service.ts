import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ContextLogger } from '../logger';

interface CacheEntry {
  data: any;
  timestamp: number;
}

@Injectable()
export class TodosService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new ContextLogger('TodosService');

  private requestCache: Map<string, CacheEntry> = new Map();
  private readonly CACHE_TTL_MS = 60000;
  private cleanupInterval: NodeJS.Timeout;
  private readonly SERVICE_TIMEOUT = 3000;

  // Retry configuration
  private readonly MAX_RETRIES = 3;
  private readonly INITIAL_RETRY_DELAY = 100;

  constructor(private readonly httpService: HttpService) {}

  onModuleInit() {
    this.startCacheCleanup();
  }

  onModuleDestroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  private startCacheCleanup() {
    const cache = this.requestCache;

    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      let removed = 0;

      for (const [key, entry] of cache.entries()) {
        if (now - entry.timestamp > this.CACHE_TTL_MS) {
          cache.delete(key);
          removed++;
        }
      }

      if (removed > 0) {
        this.logger.log('Cache cleanup completed', {
          entriesRemoved: removed,
          entriesRemaining: cache.size
        });
      }
    }, 30000);
  }

  private recreateCacheIfNeeded() {
    if (this.requestCache.size > 1000) {
      this.logger.warn('Cache size exceeded threshold, recreating', {
        oldSize: this.requestCache.size
      });
      this.requestCache = new Map();
    }
  }

  private getCached(key: string): any | null {
    const entry = this.requestCache.get(key);
    if (entry && Date.now() - entry.timestamp < this.CACHE_TTL_MS) {
      this.logger.log('Cache hit', { key });
      return entry.data;
    }
    return null;
  }

  private setCache(key: string, data: any): void {
    this.recreateCacheIfNeeded();
    this.requestCache.set(key, { data, timestamp: Date.now() });
    this.logger.log('Cache set', { key, cacheSize: this.requestCache.size });
  }

  /**
   * Retry wrapper with exponential backoff
   * Provides resilience against transient failures
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
  ): Promise<T> {
    let lastError!: Error;

    for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        if (attempt < this.MAX_RETRIES - 1) {
          // Exponential backoff with factor of 1.5 for quick recovery
          const delay = this.INITIAL_RETRY_DELAY * Math.pow(1.5, attempt);
          // Add small jitter to prevent thundering herd
          const jitter = Math.random() * 10;

          this.logger.warn(`Retry attempt ${attempt + 1}/${this.MAX_RETRIES} for ${operationName}`, {
            delay: Math.round(delay + jitter),
            error: lastError.message,
          });

          await new Promise(resolve => setTimeout(resolve, delay + jitter));
        }
      }
    }

    this.logger.error(`All retries failed for ${operationName}`, lastError);
    throw lastError;
  }

  private withTimeout<T>(promise: Promise<T>, operation: string): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`${operation} timed out after ${this.SERVICE_TIMEOUT}ms`));
      }, this.SERVICE_TIMEOUT);
    });

    return Promise.race([promise, timeoutPromise]);
  }

  async getTodos() {
    const cacheKey = 'todos:all';

    const cached = this.getCached(cacheKey);
    if (cached) {
      return cached;
    }

    this.logger.log('Fetching todos from external API');
    const startTime = Date.now();

    try {
      const response = await this.withRetry(
        () => this.withTimeout(
          this.httpService.axiosRef.get('https://dummyjson.com/todos'),
          'getTodos'
        ),
        'getTodos'
      );

      this.logger.logPerformance('getTodos', Date.now() - startTime, {
        count: response.data?.todos?.length || 0,
      });

      this.setCache(cacheKey, response.data);

      return response.data;
    } catch (error) {
      this.logger.error('Failed to fetch todos', error as Error);
      throw error;
    }
  }

  async addTodo(todo: string, userId: number) {
    this.logger.log('Adding new todo', { todo, userId });
    this.requestCache.delete('todos:all');

    const response = await this.withRetry(
      () => this.withTimeout(
        this.httpService.axiosRef.post(
          'https://dummyjson.com/todos/add',
          { todo, completed: false, userId },
        ),
        'addTodo'
      ),
      'addTodo'
    );
    return response.data;
  }

  async toggleTodoStatus(id: number, completed: boolean) {
    this.logger.log('Toggling todo status', { id, completed });
    this.requestCache.delete('todos:all');

    const response = await this.withRetry(
      () => this.withTimeout(
        this.httpService.axiosRef.put(
          `https://dummyjson.com/todos/${id}`,
          { completed },
        ),
        'toggleTodoStatus'
      ),
      'toggleTodoStatus'
    );
    return response.data;
  }

  async deleteTodo(id: number) {
    this.logger.log('Deleting todo', { id });
    this.requestCache.delete('todos:all');

    const response = await this.withRetry(
      () => this.withTimeout(
        this.httpService.axiosRef.delete(`https://dummyjson.com/todos/${id}`),
        'deleteTodo'
      ),
      'deleteTodo'
    );
    return response.data;
  }
}
