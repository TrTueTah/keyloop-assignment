import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDataSource } from '../../src/infrastructure/persistence/data-source';
import { seed } from '../../src/infrastructure/persistence/seed/seed';

export const DB_URL_FILE = join(__dirname, '.db-url');

/** Starts ONE real PostgreSQL 17 per test run, migrates and seeds it (Constitution III, research R11). */
export default async function globalSetup(): Promise<void> {
  const container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const url = container.getConnectionUri();
  const ds = await createDataSource({ databaseUrl: url, dbPoolMax: 5 }).initialize();
  await ds.runMigrations({ transaction: 'each' });
  await seed(ds);
  await ds.destroy();
  process.env.DATABASE_URL = url;
  writeFileSync(DB_URL_FILE, url);
  (globalThis as unknown as { __PG__: unknown }).__PG__ = container;
}
