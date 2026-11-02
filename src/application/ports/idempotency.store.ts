import { Appointment } from '../../domain/model/appointment';
import { TenantContext } from '../tenant-context';

/** Looks up a previous successful booking by its Idempotency-Key (unique per tenant, FR-010). */
export interface IdempotencyStore {
  findByKey(ctx: TenantContext, key: string): Promise<Appointment | null>;
}
export const IDEMPOTENCY_STORE = Symbol('IDEMPOTENCY_STORE');
