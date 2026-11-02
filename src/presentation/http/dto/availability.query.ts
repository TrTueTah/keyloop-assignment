import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, Matches } from 'class-validator';
import { IsUuidLike } from './is-uuid-like';

export class AvailabilityQuery {
  @ApiProperty({ format: 'uuid' })
  @IsUuidLike()
  serviceTypeId!: string;

  @ApiProperty({ format: 'date', example: '2026-11-10', description: 'Dealership-local date' })
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date!: string;
}
