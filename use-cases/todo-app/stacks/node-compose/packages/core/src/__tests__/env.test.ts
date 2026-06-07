import { describe, it, expect } from 'vitest';
import { parseEnv, EnvSchema } from '../env';

describe('EnvSchema', () => {
  const validEnv = {
    NODE_ENV: 'development',
    API_PORT: '3000',
    UI_PORT: '3001',
    DATABASE_URL: 'postgresql://todo:todopass@127.0.0.1:5432/tododb',
    REDIS_URL: 'redis://localhost:6379',
  };

  it('parses valid environment', () => {
    const result = parseEnv(validEnv);
    expect(result.API_PORT).toBe(3000);
    expect(result.UI_PORT).toBe(3001);
    expect(result.NODE_ENV).toBe('development');
  });

  it('coerces string ports to numbers', () => {
    const result = parseEnv(validEnv);
    expect(typeof result.API_PORT).toBe('number');
    expect(typeof result.UI_PORT).toBe('number');
  });

  it('applies defaults for optional fields', () => {
    const result = parseEnv(validEnv);
    expect(result.METRICS_PROVIDER).toBe('');
  });

  it('applies default ports when omitted', () => {
    const { API_PORT, UI_PORT, ...withoutPorts } = validEnv;
    const result = parseEnv(withoutPorts);
    expect(result.API_PORT).toBe(3000);
    expect(result.UI_PORT).toBe(3001);
  });

  it('throws on missing DATABASE_URL', () => {
    const { DATABASE_URL, ...invalid } = validEnv;
    expect(() => parseEnv(invalid)).toThrow('Environment validation failed');
  });

  it('throws on missing REDIS_URL', () => {
    const { REDIS_URL, ...invalid } = validEnv;
    expect(() => parseEnv(invalid)).toThrow('Environment validation failed');
  });

  it('rejects invalid NODE_ENV', () => {
    expect(() => parseEnv({ ...validEnv, NODE_ENV: 'staging' })).toThrow();
  });

  it('accepts production NODE_ENV', () => {
    const result = parseEnv({ ...validEnv, NODE_ENV: 'production' });
    expect(result.NODE_ENV).toBe('production');
  });
});
