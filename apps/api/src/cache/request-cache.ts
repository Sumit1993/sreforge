interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export class RequestCache<T = unknown> {
  private cache = new Map<string, CacheEntry<T>>();
  private readonly ttl: number;
  private readonly cleanupIntervalMs: number;
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(ttlMs: number = 30000, cleanupIntervalMs: number = 60000) {
    this.ttl = ttlMs;
    this.cleanupIntervalMs = cleanupIntervalMs;
    this.cleanupInterval = this.startCleanupTimer();
  }

  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    const age = Date.now() - entry.timestamp;
    if (age <= this.ttl) {
      return entry.data;
    }

    this.cache.delete(key);
    return null;
  }

  set(key: string, data: T): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  reset(): void {
    const oldCache = this.cache;
    this.cache = new Map<string, CacheEntry<T>>();
    oldCache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  private startCleanupTimer(): ReturnType<typeof setInterval> {
    const cache = this.cache;
    return setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of cache.entries()) {
        if (now - entry.timestamp <= this.ttl) {
          continue;
        }
        cache.delete(key);
      }
    }, this.cleanupIntervalMs);
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.cache.clear();
  }
}
