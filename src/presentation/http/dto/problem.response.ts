import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ERROR_CODES } from '../../../domain/errors';

export class SlotDto {
  @ApiProperty({ format: 'date-time' }) startAt!: string;
  @ApiProperty({ format: 'date-time' }) endAt!: string;
  @ApiProperty({ minimum: 1 }) availableTechnicians!: number;
  @ApiProperty({ minimum: 1 }) availableBays!: number;
}

class FieldErrorDto {
  @ApiProperty() field!: string;
  @ApiProperty() message!: string;
}

/** RFC 9457 problem details (documentation only; produced by ProblemFilter). */
export class ProblemResponse {
  @ApiProperty() type!: string;
  @ApiProperty() title!: string;
  @ApiProperty() status!: number;
  @ApiProperty({ enum: ERROR_CODES }) code!: string;
  @ApiPropertyOptional() detail?: string;
  @ApiPropertyOptional() instance?: string;
  @ApiPropertyOptional() requestId?: string;
  @ApiPropertyOptional({ type: [FieldErrorDto] }) errors?: FieldErrorDto[];
  @ApiPropertyOptional({ type: [SlotDto], description: 'SLOT_UNAVAILABLE only' })
  alternatives?: SlotDto[];
}
