/**
 * Rate Limiter Service
 * Extracted for better testability and separation of concerns
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
   * Uses sliding window algorithm
   */
  shouldLimit(key: string): boolean {
    const now = Date.now();
    const record = this.requestCounts.get(key);

    if (!record || now - record.windowStart > this.windowMs) {
      // New window - reset counter
      this.requestCounts.set(key, { count: 1, windowStart: now });
      return false;
    }

    // Within window - check and increment atomically
    if (record.count >= this.maxRequests) {
      return true;
    }

    record.count++;
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
   * Clear all rate limit records (for testing)
   */
  clear(): void {
    this.requestCounts.clear();
  }
}
