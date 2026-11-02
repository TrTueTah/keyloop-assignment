import { ApiProperty } from '@nestjs/swagger';
import { AppointmentEvent } from '../../../domain/model/appointment';
import { AppointmentResponse } from './appointment.response';

export class AppointmentPageResponse {
  @ApiProperty({ type: [AppointmentResponse] }) items!: AppointmentResponse[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}

export class AppointmentEventResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['CREATED', 'REASSIGNED', 'CANCELLED'] }) type!: string;
  @ApiProperty() actor!: string;
  @ApiProperty({ format: 'date-time' }) occurredAt!: string;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'IDs/enums only (no PII)',
  })
  payload!: Record<string, unknown>;
}

export const toEventResponse = (e: AppointmentEvent): AppointmentEventResponse => ({
  id: e.id,
  type: e.type,
  actor: e.actor,
  occurredAt: e.occurredAt.toUTC().toISO()!,
  payload: { ...e.payload },
});
