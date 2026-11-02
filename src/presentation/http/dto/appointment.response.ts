import { ApiProperty } from '@nestjs/swagger';
import { Appointment, BOOKING_CHANNELS } from '../../../domain/model/appointment';
import { DateTime } from '../../../domain/time';

export class AppointmentResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) dealershipId!: string;
  @ApiProperty({ format: 'uuid' }) customerId!: string;
  @ApiProperty({ format: 'uuid' }) vehicleId!: string;
  @ApiProperty({ format: 'uuid' }) serviceTypeId!: string;
  @ApiProperty({ format: 'uuid' }) technicianId!: string;
  @ApiProperty({ format: 'uuid' }) serviceBayId!: string;
  @ApiProperty({ format: 'date-time', description: "Rendered in the dealership's offset" })
  startAt!: string;
  @ApiProperty({ format: 'date-time' }) endAt!: string;
  @ApiProperty({ enum: ['CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'] }) status!: string;
  @ApiProperty({ enum: ['AUTO', 'MANUAL'] }) assignmentMode!: string;
  @ApiProperty({ enum: BOOKING_CHANNELS }) channel!: string;
  @ApiProperty() createdBy!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

const iso = (d: DateTime, zone?: string) =>
  (zone ? d.setZone(zone) : d.toUTC()).toISO({ suppressMilliseconds: true })!;

/** Domain → wire. Internal fields (idempotency key, request hash, tenant id) are never exposed. */
export function toAppointmentResponse(a: Appointment, timezone?: string): AppointmentResponse {
  return {
    id: a.id,
    dealershipId: a.dealershipId,
    customerId: a.customerId,
    vehicleId: a.vehicleId,
    serviceTypeId: a.serviceTypeId,
    technicianId: a.technicianId,
    serviceBayId: a.serviceBayId,
    startAt: iso(a.startAt, timezone),
    endAt: iso(a.endAt, timezone),
    status: a.status,
    assignmentMode: a.assignmentMode,
    channel: a.channel,
    createdBy: a.createdBy,
    version: a.version,
    createdAt: iso(a.createdAt),
    updatedAt: iso(a.updatedAt),
  };
}
