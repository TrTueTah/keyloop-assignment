import { ApiProperty } from '@nestjs/swagger';
import { SlotDto } from './problem.response';

export class AvailabilityResponse {
  @ApiProperty({ format: 'uuid' }) dealershipId!: string;
  @ApiProperty({ format: 'uuid' }) serviceTypeId!: string;
  @ApiProperty({ format: 'date' }) date!: string;
  @ApiProperty({ example: 'Europe/London' }) timezone!: string;
  @ApiProperty({ type: [SlotDto] }) slots!: SlotDto[];
}
