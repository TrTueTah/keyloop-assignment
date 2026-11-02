export interface AppConfig {
  port: number;
  databaseUrl: string;
  dbPoolMax: number;
  logLevel: string;
  nodeEnv: string;
  serviceName: string;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing required environment variable ${key}`);
  }
  return value;
}

function int(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0)
    throw new Error(`Environment variable ${key} must be a positive integer`);
  return n;
}

/** Parses and validates configuration once at startup; fails fast on bad values. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: int(env, 'PORT', 3000),
    databaseUrl: required(env, 'DATABASE_URL'),
    dbPoolMax: int(env, 'DB_POOL_MAX', 20),
    logLevel: env.LOG_LEVEL ?? 'info',
    nodeEnv: env.NODE_ENV ?? 'development',
    serviceName: env.OTEL_SERVICE_NAME ?? 'service-scheduler',
  };
}
