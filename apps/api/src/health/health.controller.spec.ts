import { HealthController } from './health.controller';

function createMockPrisma() {
  return {
    $queryRawUnsafe: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
  } as any;
}

function createMockCacheProvider() {
  return {
    ping: jest.fn().mockResolvedValue(true),
  } as any;
}

describe('HealthController', () => {
  let controller: HealthController;
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let mockCache: ReturnType<typeof createMockCacheProvider>;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    mockCache = createMockCacheProvider();
    controller = new HealthController(mockPrisma, mockCache);
  });

  it('returns ok when both DB and cache are connected', async () => {
    const result = await controller.check();
    expect(result.status).toBe('ok');
    expect(result.database).toBe('connected');
    expect(result.cache).toBe('connected');
    expect(result.timestamp).toBeDefined();
    expect(result.uptime).toBeGreaterThan(0);
    expect(result.memoryUsage).toBeDefined();
  });

  it('returns ok with cache disconnected (cache is non-critical)', async () => {
    mockCache.ping.mockResolvedValue(false);
    const result = await controller.check();
    expect(result.status).toBe('ok');
    expect(result.database).toBe('connected');
    expect(result.cache).toBe('disconnected');
  });

  it('returns degraded when DB is disconnected', async () => {
    mockPrisma.$queryRawUnsafe.mockRejectedValue(new Error('connection refused'));
    const result = await controller.check();
    expect(result.status).toBe('degraded');
    expect(result.database).toBe('disconnected');
  });

  it('returns degraded when both DB and cache are down', async () => {
    mockPrisma.$queryRawUnsafe.mockRejectedValue(new Error('DB down'));
    mockCache.ping.mockRejectedValue(new Error('Redis down'));
    const result = await controller.check();
    expect(result.status).toBe('degraded');
    expect(result.database).toBe('disconnected');
    expect(result.cache).toBe('disconnected');
  });
});
