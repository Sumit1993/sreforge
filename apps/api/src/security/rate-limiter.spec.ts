import { RateLimiter } from './rate-limiter';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter(60000, 3);
  });

  it('allows requests under the limit', () => {
    expect(limiter.shouldLimit('user:1')).toBe(false);
    expect(limiter.shouldLimit('user:1')).toBe(false);
    expect(limiter.shouldLimit('user:1')).toBe(false);
  });

  it('blocks requests at the limit', () => {
    limiter.shouldLimit('user:1');
    limiter.shouldLimit('user:1');
    limiter.shouldLimit('user:1');
    expect(limiter.shouldLimit('user:1')).toBe(true);
  });

  it('tracks separate keys independently', () => {
    limiter.shouldLimit('user:1');
    limiter.shouldLimit('user:1');
    limiter.shouldLimit('user:1');
    expect(limiter.shouldLimit('user:1')).toBe(true);
    expect(limiter.shouldLimit('user:2')).toBe(false);
  });

  it('resets after window expires', () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);

    limiter.shouldLimit('user:1');
    limiter.shouldLimit('user:1');
    limiter.shouldLimit('user:1');
    expect(limiter.shouldLimit('user:1')).toBe(true);

    // Advance past window
    jest.spyOn(Date, 'now').mockReturnValue(now + 60001);
    expect(limiter.shouldLimit('user:1')).toBe(false);

    jest.restoreAllMocks();
  });

  it('getCount returns current count', () => {
    expect(limiter.getCount('user:1')).toBe(0);
    limiter.shouldLimit('user:1');
    expect(limiter.getCount('user:1')).toBe(1);
    limiter.shouldLimit('user:1');
    expect(limiter.getCount('user:1')).toBe(2);
  });

  it('clear resets all records', () => {
    limiter.shouldLimit('user:1');
    limiter.shouldLimit('user:2');
    limiter.clear();
    expect(limiter.getCount('user:1')).toBe(0);
    expect(limiter.getCount('user:2')).toBe(0);
  });

  it('uses default values when no args provided', () => {
    const defaultLimiter = new RateLimiter();
    // Should allow 100 requests by default
    for (let i = 0; i < 100; i++) {
      expect(defaultLimiter.shouldLimit('key')).toBe(false);
    }
    expect(defaultLimiter.shouldLimit('key')).toBe(true);
  });
});
