import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Min, ValidateIf } from 'class-validator';
import { IsUuidLike } from './is-uuid-like';

export class ReassignRequest {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((o: ReassignRequest) => o.technicianId !== undefined || o.serviceBayId === undefined)
  @IsUuidLike()
  technicianId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUuidLike()
  serviceBayId?: string;
}
