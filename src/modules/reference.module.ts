import { Module } from '@nestjs/common';
import { REFERENCE_QUERY, ReferenceQuery } from '../application/ports/reference.query';
import { ListReferenceData } from '../application/use-cases/list-reference-data';
import { ReferenceController } from '../presentation/http/controllers/reference.controller';

/** Read-only reference data use cases + controller (composition root). */
@Module({
  controllers: [ReferenceController],
  providers: [
    {
      provide: ListReferenceData,
      useFactory: (ref: ReferenceQuery) => new ListReferenceData(ref),
      inject: [REFERENCE_QUERY],
    },
  ],
})
export class ReferenceModule {}
