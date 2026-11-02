import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AppointmentStatus } from '../../../domain/model/appointment';
import { IsUuidLike } from './is-uuid-like';

const STATUSES: AppointmentStatus[] = ['CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'];

export class ListAppointmentsQueryDto {
  @ApiProperty({ format: 'date', description: 'Dealership-local date' })
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date!: string;

  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: AppointmentStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUuidLike()
  technicianId?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Opaque cursor from nextCursor' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}
