import { DateTime } from 'luxon';

export type AppointmentStatus = 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW';
export type AssignmentMode = 'AUTO' | 'MANUAL';
export const BOOKING_CHANNELS = ['ONLINE', 'PHONE', 'WALK_IN', 'ADVISOR'] as const;
export type BookingChannel = (typeof BOOKING_CHANNELS)[number];

export interface Appointment {
  readonly id: string;
  readonly tenantId: string;
  readonly dealershipId: string;
  readonly customerId: string;
  readonly vehicleId: string;
  readonly serviceTypeId: string;
  readonly technicianId: string;
  readonly serviceBayId: string;
  readonly startAt: DateTime;
  readonly endAt: DateTime;
  readonly status: AppointmentStatus;
  readonly assignmentMode: AssignmentMode;
  readonly channel: BookingChannel;
  readonly createdBy: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly version: number;
  readonly createdAt: DateTime;
  readonly updatedAt: DateTime;
}

export function isConfirmed(a: Pick<Appointment, 'status'>): boolean {
  return a.status === 'CONFIRMED';
}

export type AppointmentEventType = 'CREATED' | 'REASSIGNED' | 'CANCELLED';

/** Append-only history entry. Payload holds IDs/enums/timestamps only, never PII (FR-027). */
export interface AppointmentEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly appointmentId: string;
  readonly type: AppointmentEventType;
  readonly actor: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: DateTime;
}
