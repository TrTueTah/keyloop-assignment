import { DateTime } from 'luxon';
import {
  Appointment,
  AppointmentEvent,
  AppointmentEventType,
  AppointmentStatus,
  AssignmentMode,
  BookingChannel,
} from '../../../domain/model/appointment';
import { AppointmentEventOrmEntity, AppointmentOrmEntity } from '../orm-entities';

const dt = (d: Date | string) =>
  DateTime.fromJSDate(d instanceof Date ? d : new Date(d), { zone: 'utc' });

export function toDomain(e: AppointmentOrmEntity): Appointment {
  return {
    id: e.id,
    tenantId: e.tenantId,
    dealershipId: e.dealershipId,
    customerId: e.customerId,
    vehicleId: e.vehicleId,
    serviceTypeId: e.serviceTypeId,
    technicianId: e.technicianId,
    serviceBayId: e.serviceBayId,
    startAt: dt(e.startAt),
    endAt: dt(e.endAt),
    status: e.status as AppointmentStatus,
    assignmentMode: e.assignmentMode as AssignmentMode,
    channel: e.channel as BookingChannel,
    createdBy: e.createdBy,
    idempotencyKey: e.idempotencyKey,
    requestHash: e.requestHash,
    version: e.version,
    createdAt: dt(e.createdAt),
    updatedAt: dt(e.updatedAt),
  };
}

export function toOrm(a: Appointment): AppointmentOrmEntity {
  const e = new AppointmentOrmEntity();
  Object.assign(e, {
    ...a,
    startAt: a.startAt.toJSDate(),
    endAt: a.endAt.toJSDate(),
    createdAt: a.createdAt.toJSDate(),
    updatedAt: a.updatedAt.toJSDate(),
  });
  return e;
}

/** Maps a raw `RETURNING *` / SELECT row (snake_case) to the domain model. */
export function rowToDomain(r: Record<string, unknown>): Appointment {
  const e = new AppointmentOrmEntity();
  Object.assign(e, {
    id: r.id,
    tenantId: r.tenant_id,
    dealershipId: r.dealership_id,
    customerId: r.customer_id,
    vehicleId: r.vehicle_id,
    serviceTypeId: r.service_type_id,
    technicianId: r.technician_id,
    serviceBayId: r.service_bay_id,
    startAt: r.start_at,
    endAt: r.end_at,
    status: r.status,
    assignmentMode: r.assignment_mode,
    channel: r.channel,
    createdBy: r.created_by,
    idempotencyKey: r.idempotency_key,
    requestHash: r.request_hash,
    version: r.version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });
  return toDomain(e);
}

export function eventToDomain(e: AppointmentEventOrmEntity): AppointmentEvent {
  return {
    id: e.id,
    tenantId: e.tenantId,
    appointmentId: e.appointmentId,
    type: e.type as AppointmentEventType,
    actor: e.actor,
    payload: e.payload as Record<string, unknown>,
    occurredAt: dt(e.occurredAt),
  };
}

export function eventToOrm(ev: AppointmentEvent): AppointmentEventOrmEntity {
  const e = new AppointmentEventOrmEntity();
  Object.assign(e, { ...ev, occurredAt: ev.occurredAt.toJSDate(), publishedAt: null });
  return e;
}
