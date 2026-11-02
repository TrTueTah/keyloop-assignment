/**
 * Error-code catalogue (Constitution VI). MUST equal `ErrorCode` in
 * specs/001-service-appointment-scheduler/contracts/openapi.yaml and docs/system-design.md §7.
 * HTTP status mapping lives only in presentation (Constitution IV).
 */
export const ERROR_CODES = [
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'START_IN_PAST',
  'NOT_ON_SLOT_GRID',
  'OUTSIDE_BOOKING_HORIZON',
  'OUTSIDE_OPENING_HOURS',
  'VEHICLE_NOT_OWNED_BY_CUSTOMER',
  'TECHNICIAN_NOT_QUALIFIED',
  'BAY_NOT_COMPATIBLE',
  'RESOURCE_INACTIVE',
  'RESOURCE_NOT_IN_DEALERSHIP',
  'IDEMPOTENCY_KEY_REUSED',
  'SLOT_UNAVAILABLE',
  'RESOURCE_UNAVAILABLE',
  'VEHICLE_ALREADY_BOOKED',
  'STALE_VERSION',
  'NOT_CONFIRMED',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface FieldError {
  field: string;
  message: string;
}

/** Extra, non-PII details carried to the client (e.g. alternative slots, field errors). */
export interface DomainErrorMeta {
  alternatives?: {
    startAt: string;
    endAt: string;
    availableTechnicians: number;
    availableBays: number;
  }[];
  errors?: FieldError[];
}

export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly detail?: string,
    readonly meta: DomainErrorMeta = {},
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'DomainError';
  }
}
