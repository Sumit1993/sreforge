import { z } from 'zod';

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Service ports
  API_PORT: z.coerce.number().default(3000),
  UI_PORT: z.coerce.number().default(3001),
  // Phase 4: multi-language APIs
  // API_PYTHON_PORT: z.coerce.number().default(8000),
  // API_JAVA_PORT: z.coerce.number().default(8080),
  // API_GO_PORT: z.coerce.number().default(8081),

  // Database
  DATABASE_URL: z.string().min(1),

  // Cache (Valkey — Redis-compatible)
  REDIS_URL: z.string().min(1),

  // Metrics (optional)
  METRICS_PROVIDER: z.enum(['local', 'grafana', '']).default(''),
  LOCAL_PUSHGATEWAY_URL: z.string().optional(),

  // Grafana (optional)
  GRAFANA_LOKI_URL: z.string().optional(),
  GRAFANA_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(env: Record<string, string | undefined>): Env {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${formatted}`);
  }
  return result.data;
}
