import { EntityManager } from 'typeorm';

/**
 * TypeORM's postgres driver returns `[rows, rowCount]` for UPDATE/DELETE and `rows` for SELECT.
 * Normalises both shapes to rows.
 */
export async function queryRows<T = Record<string, unknown>>(
  em: EntityManager,
  sql: string,
  params: unknown[],
): Promise<T[]> {
  const raw: unknown = await em.query(sql, params);
  if (
    Array.isArray(raw) &&
    raw.length === 2 &&
    Array.isArray(raw[0]) &&
    typeof raw[1] === 'number'
  ) {
    return raw[0] as T[];
  }
  return raw as T[];
}

/** Path ids are user input: a malformed uuid is simply "not found", never a 500. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string | undefined): v is string =>
  typeof v === 'string' && UUID_RE.test(v);
