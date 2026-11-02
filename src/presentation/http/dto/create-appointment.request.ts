import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional, Matches } from 'class-validator';
import { IsUuidLike } from './is-uuid-like';
import { BOOKING_CHANNELS, BookingChannel } from '../../../domain/model/appointment';

/** Mirrors contracts/openapi.yaml#/components/schemas/CreateAppointmentRequest (no duration: FR-002). */
export class CreateAppointmentRequest {
  @ApiProperty({ format: 'uuid' })
  @IsUuidLike()
  customerId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUuidLike()
  vehicleId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUuidLike()
  serviceTypeId!: string;

  @ApiProperty({
    format: 'date-time',
    example: '2026-11-10T10:00:00+00:00',
    description: 'ISO-8601 with offset; must be on the dealership-local 15-minute grid',
  })
  @IsISO8601({ strict: true })
  @Matches(/(Z|[+-]\d{2}:\d{2})$/, { message: 'startAt must include a UTC offset' })
  startAt!: string;

  @ApiPropertyOptional({ enum: BOOKING_CHANNELS, default: 'ADVISOR' })
  @IsOptional()
  @IsIn(BOOKING_CHANNELS)
  channel?: BookingChannel;

  @ApiPropertyOptional({ format: 'uuid', description: 'Optional pin (FR-014)' })
  @IsOptional()
  @IsUuidLike()
  technicianId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Optional pin (FR-014)' })
  @IsOptional()
  @IsUuidLike()
  serviceBayId?: string;
}
