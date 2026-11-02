import { DomainError } from '../../domain/errors';
import { Appointment, AppointmentEvent, AppointmentStatus } from '../../domain/model/appointment';
import { DateTime, localDayBounds } from '../../domain/time';
import { AppointmentEventRepository } from '../ports/appointment-event.repository';
import { AppointmentRepository } from '../ports/appointment.repository';
import { ReferenceQuery } from '../ports/reference.query';
import { SiteContext } from '../tenant-context';

export interface ListAppointmentsQuery {
  readonly date: string;
  readonly status?: AppointmentStatus;
  readonly technicianId?: string;
  readonly limit: number;
  readonly cursor?: string;
}

export interface AppointmentPage {
  readonly items: Appointment[];
  readonly nextCursor: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Opaque keyset cursor over (start_at, id): base64url of {s, i}. */
export function encodeCursor(a: Pick<Appointment, 'startAt' | 'id'>): string {
  return Buffer.from(JSON.stringify({ s: a.startAt.toUTC().toISO(), i: a.id })).toString(
    'base64url',
  );
}

function decodeCursor(cursor: string): { startAt: DateTime; id: string } {
  try {
    const raw = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      s?: unknown;
      i?: unknown;
    };
    const startAt = typeof raw.s === 'string' ? DateTime.fromISO(raw.s, { zone: 'utc' }) : null;
    if (startAt?.isValid && typeof raw.i === 'string' && UUID.test(raw.i))
      return { startAt, id: raw.i };
  } catch {
    // fall through
  }
  throw new DomainError('VALIDATION_FAILED', 'Invalid cursor', {
    errors: [{ field: 'cursor', message: 'invalid' }],
  });
}

/** FR-020: the dealership's appointments starting on a LOCAL date, in (start, id) order, paged. */
export class ListAppointments {
  constructor(
    private readonly appointments: AppointmentRepository,
    private readonly reference: ReferenceQuery,
  ) {}

  async execute(ctx: SiteContext, q: ListAppointmentsQuery): Promise<AppointmentPage> {
    const zone =
      ctx.timezone ??
      (await this.reference.findDealershipInTenant(ctx.tenantId, ctx.dealershipId))?.timezone;
    if (!zone) throw new DomainError('NOT_FOUND', 'Dealership not found');
    const after = q.cursor ? decodeCursor(q.cursor) : undefined;
    const rows = await this.appointments.listForDay(
      ctx,
      localDayBounds(q.date, zone),
      { status: q.status, technicianId: q.technicianId },
      { limit: q.limit + 1, after },
    );
    const items = rows.slice(0, q.limit);
    return {
      items,
      nextCursor: rows.length > q.limit ? encodeCursor(items[items.length - 1]) : null,
    };
  }
}

/** FR-021: an appointment's history in time order. */
export class ListAppointmentEvents {
  constructor(
    private readonly appointments: AppointmentRepository,
    private readonly events: AppointmentEventRepository,
  ) {}

  async execute(ctx: SiteContext, appointmentId: string): Promise<AppointmentEvent[]> {
    const appointment = await this.appointments.findById(ctx, appointmentId);
    if (!appointment) throw new DomainError('NOT_FOUND', 'Appointment not found');
    return this.events.listForAppointment(ctx, appointmentId);
  }
}
