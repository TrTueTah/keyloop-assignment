import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { DB_URL_FILE } from './global-setup';

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? readFileSync(DB_URL_FILE, 'utf8');
}

/** Raw SQL helper for direct-database assertions (isolation, schema, fixtures). */
export async function sql<T extends Record<string, unknown> = Record<string, unknown>>(
  query: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    const res = await client.query(query, params);
    return res.rows as T[];
  } finally {
    await client.end();
  }
}

/** Resets transactional data between tests; reference data (the seed) is left intact. */
export async function truncateTransactional(): Promise<void> {
  await sql('TRUNCATE appointment_event, appointment');
}
