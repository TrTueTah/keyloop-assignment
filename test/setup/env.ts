process.env.OTEL_SDK_DISABLED = 'true';
process.env.DB_POOL_MAX = process.env.DB_POOL_MAX ?? '25';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
