import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ContextLogger } from '../logger';
import { PrismaTodoRepository } from './adapters/prisma-todo.repository';
import { RedisCacheProvider } from '../cache/redis-cache.provider';

interface CacheEntry {
  data: any;
  timestamp: number;
}

@Injectable()
export class TodosService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new ContextLogger('TodosService');

  // BUG #3: In-memory cache kept alongside Redis.
  // The closure capture bug is preserved: startCacheCleanup captures `this.requestCache`
  // by reference at init time. If recreateCacheIfNeeded reassigns it, the cleanup
  // interval still references the old Map -- causing a memory leak.
  private requestCache: Map<string, CacheEntry> = new Map();
  private readonly CACHE_TTL_MS = 60000;
  private cleanupInterval: NodeJS.Timeout;

  // BUG #4: Timeout mismatch -- SERVICE_TIMEOUT (3s) vs HttpModule.timeout (5s)
  // The timeout wrapper still wraps DB operations.
  private readonly SERVICE_TIMEOUT = 3000;

  // BUG #5: Aggressive retry -- retries ALL errors including Prisma validation errors
  private readonly MAX_RETRIES = 3;
  private readonly INITIAL_RETRY_DELAY = 100;

  constructor(
    private readonly todoRepository: PrismaTodoRepository,
    private readonly redisCacheProvider: RedisCacheProvider,
  ) {}

  onModuleInit() {
    this.startCacheCleanup();
  }

  onModuleDestroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  // BUG #3: Closure captures `cache` reference at startup.
  // If `this.requestCache` is reassigned in recreateCacheIfNeeded(),
  // the cleanup interval still references the old Map.
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
          entriesRemaining: cache.size,
        });
      }
    }, 30000);
  }

  // BUG #3 continued: This reassigns this.requestCache, breaking the cleanup interval
  private recreateCacheIfNeeded() {
    if (this.requestCache.size > 1000) {
      this.logger.warn('Cache size exceeded threshold, recreating', {
        oldSize: this.requestCache.size,
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
   * BUG #5: Retry wrapper with exponential backoff
   * Retries ALL errors including validation errors (should skip 4xx-equivalent)
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

          this.logger.warn(
            `Retry attempt ${attempt + 1}/${this.MAX_RETRIES} for ${operationName}`,
            {
              delay: Math.round(delay + jitter),
              error: lastError.message,
            },
          );

          await new Promise((resolve) => setTimeout(resolve, delay + jitter));
        }
      }
    }

    this.logger.error(`All retries failed for ${operationName}`, lastError);
    throw lastError;
  }

  // BUG #4: Timeout of 3s wraps DB operations; HttpModule has 5s timeout (mismatch)
  private withTimeout<T>(promise: Promise<T>, operation: string): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(`${operation} timed out after ${this.SERVICE_TIMEOUT}ms`),
        );
      }, this.SERVICE_TIMEOUT);
    });

    return Promise.race([promise, timeoutPromise]);
  }

  async getTodos() {
    const cacheKey = 'todos:all';

    // Check in-memory cache first (buggy -- see closure capture bug)
    const cached = this.getCached(cacheKey);
    if (cached) {
      return cached;
    }

    // Check Redis cache
    const redisCached = await this.redisCacheProvider.get<any>(cacheKey);
    if (redisCached) {
      this.logger.log('Redis cache hit', { key: cacheKey });
      this.setCache(cacheKey, redisCached);
      return redisCached;
    }

    this.logger.log('Fetching todos from database');
    const startTime = Date.now();

    try {
      const todos = await this.withRetry(
        () => this.withTimeout(this.todoRepository.findAll(), 'getTodos'),
        'getTodos',
      );

      const result = {
        todos,
        total: todos.length,
        skip: 0,
        limit: todos.length,
      };

      this.logger.logPerformance('getTodos', Date.now() - startTime, {
        count: todos.length,
      });

      // Set both caches
      this.setCache(cacheKey, result);
      await this.redisCacheProvider.set(cacheKey, result, this.CACHE_TTL_MS);

      return result;
    } catch (error) {
      this.logger.error('Failed to fetch todos', error as Error);
      throw error;
    }
  }

  async addTodo(todo: string, userId: number) {
    this.logger.log('Adding new todo', { todo, userId });
    this.requestCache.delete('todos:all');
    await this.redisCacheProvider.delete('todos:all');

    const created = await this.withRetry(
      () =>
        this.withTimeout(
          this.todoRepository.create({ todo, userId }),
          'addTodo',
        ),
      'addTodo',
    );
    return created;
  }

  async toggleTodoStatus(id: number, completed: boolean) {
    this.logger.log('Toggling todo status', { id, completed });
    this.requestCache.delete('todos:all');
    await this.redisCacheProvider.delete('todos:all');

    const updated = await this.withRetry(
      () =>
        this.withTimeout(
          this.todoRepository.update(id, { completed }),
          'toggleTodoStatus',
        ),
      'toggleTodoStatus',
    );
    return updated;
  }

  async deleteTodo(id: number) {
    this.logger.log('Deleting todo', { id });
    this.requestCache.delete('todos:all');
    await this.redisCacheProvider.delete('todos:all');

    const deleted = await this.withRetry(
      () => this.withTimeout(this.todoRepository.delete(id), 'deleteTodo'),
      'deleteTodo',
    );
    return deleted;
  }
}
