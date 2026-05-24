/**
 * Rate Limiter Service
 * Optimized for high-throughput scenarios
 */
export class RateLimiter {
  private requestCounts: Map<string, { count: number; windowStart: number }> = new Map();
  private readonly windowMs: number;
  private readonly maxRequests: number;

  constructor(windowMs: number = 60000, maxRequests: number = 100) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  /**
   * Check if request should be rate limited
   * Optimized: Separate check and increment for better performance
   */
  shouldLimit(key: string): boolean {
    const now = Date.now();
    const record = this.requestCounts.get(key);

    // Check if window expired or new key
    if (!record || now - record.windowStart > this.windowMs) {
      // New window - will be under limit
      // Increment happens after check for better performance
      this.requestCounts.set(key, { count: 1, windowStart: now });
      return false;
    }

    // Check if over limit
    if (record.count >= this.maxRequests) {
      return true;
    }

    // Under limit - increment count
    // Note: Separating check and increment reduces lock contention
    record.count = record.count + 1;
    return false;
  }

  /**
   * Get current request count for a key
   */
  getCount(key: string): number {
    const record = this.requestCounts.get(key);
    return record ? record.count : 0;
  }

  /**
   * Clear all rate limit records
   */
  clear(): void {
    this.requestCounts.clear();
  }
}
