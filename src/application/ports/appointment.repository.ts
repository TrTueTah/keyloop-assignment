import { Interval } from '../../domain/interval';
import { DateTime } from '../../domain/time';
import { Appointment, AppointmentStatus } from '../../domain/model/appointment';
import { SiteContext, TenantContext } from '../tenant-context';

/**
 * What a write collided with, already translated from driver errors by the adapter (Constitution IV/V).
 * `transient` = the database aborted the transaction to break a deadlock / serialization failure
 * between concurrent writers; nothing was written and the attempt may simply be retried.
 */
export type ConflictTarget = 'technician' | 'bay' | 'vehicle' | 'idempotency_key' | 'transient';

export type InsertOutcome =
  | { readonly kind: 'inserted'; readonly appointment: Appointment }
  | { readonly kind: 'conflict'; readonly on: ConflictTarget };

export type AppointmentPatch =
  | { readonly status: 'CANCELLED' }
  | {
      readonly technicianId: string;
      readonly serviceBayId: string;
      readonly assignmentMode: 'MANUAL';
    };

export type UpdateOutcome =
  | { readonly kind: 'updated'; readonly appointment: Appointment }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'not_confirmed' }
  | { readonly kind: 'stale' }
  | { readonly kind: 'conflict'; readonly on: Exclude<ConflictTarget, 'idempotency_key'> };

export interface DayFilter {
  readonly status?: AppointmentStatus;
  readonly technicianId?: string;
}

export interface PageRequest {
  readonly limit: number;
  readonly after?: { readonly startAt: DateTime; readonly id: string };
}

export interface AppointmentRepository {
  insert(ctx: SiteContext, appointment: Appointment): Promise<InsertOutcome>;
  findById(ctx: SiteContext, id: string): Promise<Appointment | null>;
  /** Explicit `WHERE … AND version = :expected` update; never relies on ORM versioning (R7). */
  updateIfVersion(
    ctx: SiteContext,
    id: string,
    expectedVersion: number,
    patch: AppointmentPatch,
    now: DateTime,
  ): Promise<UpdateOutcome>;
  listForDay(
    ctx: SiteContext,
    range: Interval,
    filter: DayFilter,
    page: PageRequest,
  ): Promise<Appointment[]>;
}
export const APPOINTMENT_REPOSITORY = Symbol('APPOINTMENT_REPOSITORY');

export type { TenantContext };
