import { QueryFailedError } from 'typeorm';
import { ConflictTarget } from '../../application/ports/appointment.repository';

/**
 * The ONLY place that knows constraint names (Constitution IV/V, research R2). Driver errors are
 * classified by constraint NAME, not SQLSTATE alone, and returned as typed port outcomes.
 */
const BY_CONSTRAINT: Readonly<Record<string, { code: string; on: ConflictTarget }>> = {
  no_technician_overlap: { code: '23P01', on: 'technician' },
  no_bay_overlap: { code: '23P01', on: 'bay' },
  no_vehicle_overlap: { code: '23P01', on: 'vehicle' },
  uq_appt_idempotency: { code: '23505', on: 'idempotency_key' },
};

/**
 * Concurrent inserts that each check the exclusion constraints can wait on one another; PostgreSQL
 * breaks the cycle by aborting one transaction with 40P01 (found by the SC-003 burst test). These
 * carry no constraint name, so SQLSTATE is the only signal; they are retryable, never a 500.
 */
const TRANSIENT_SQLSTATES = new Set(['40P01', '40001']);

export function toConflict(e: unknown): { kind: 'conflict'; on: ConflictTarget } | null {
  if (!(e instanceof QueryFailedError)) return null;
  const d = e.driverError as { code?: string; constraint?: string } | undefined;
  if (d?.code && TRANSIENT_SQLSTATES.has(d.code)) return { kind: 'conflict', on: 'transient' };
  if (!d?.constraint) return null;
  const known = BY_CONSTRAINT[d.constraint];
  return known && known.code === d.code ? { kind: 'conflict', on: known.on } : null;
}
