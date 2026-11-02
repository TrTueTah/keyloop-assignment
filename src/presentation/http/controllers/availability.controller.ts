import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { SiteContext } from '../../../application/tenant-context';
import { SearchAvailability } from '../../../application/use-cases/search-availability';
import { AvailabilityQuery } from '../dto/availability.query';
import { AvailabilityResponse } from '../dto/availability.response';
import { ProblemResponse } from '../dto/problem.response';
import { ApiIdentityHeaders } from '../tenant/api-identity-headers.decorator';
import { Site } from '../tenant/tenant-context.decorator';
import { TenantGuard } from '../tenant/tenant.guard';

@ApiTags('Availability')
@ApiIdentityHeaders()
@Controller('api/v1/dealerships/:dealershipId/availability')
@UseGuards(TenantGuard)
export class AvailabilityController {
  constructor(private readonly search: SearchAvailability) {}

  @Get()
  @ApiOkResponse({ type: AvailabilityResponse })
  @ApiNotFoundResponse({ type: ProblemResponse })
  @ApiUnprocessableEntityResponse({ type: ProblemResponse })
  async availability(
    @Site() ctx: SiteContext,
    @Query() query: AvailabilityQuery,
  ): Promise<AvailabilityResponse> {
    return this.search.execute(ctx, query.serviceTypeId, query.date);
  }
}
