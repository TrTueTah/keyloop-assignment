import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class VersionedRequest {
  @ApiProperty({
    minimum: 1,
    description: 'The version you last read (optimistic concurrency, FR-019)',
  })
  @IsInt()
  @Min(1)
  version!: number;
}
