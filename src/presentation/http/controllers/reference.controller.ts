import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { SiteContext, TenantContext } from '../../../application/tenant-context';
import { ListReferenceData } from '../../../application/use-cases/list-reference-data';
import { ProblemResponse } from '../dto/problem.response';
import {
  DealershipResponse,
  ServiceBayResponse,
  ServiceTypeResponse,
  TechnicianResponse,
  toDealershipResponse,
  toServiceBayResponse,
  toServiceTypeResponse,
  toTechnicianResponse,
} from '../dto/reference.response';
import { ApiIdentityHeaders } from '../tenant/api-identity-headers.decorator';
import { Site, Tenant } from '../tenant/tenant-context.decorator';
import { TenantGuard } from '../tenant/tenant.guard';

@ApiTags('Reference')
@ApiIdentityHeaders()
@Controller('api/v1')
@UseGuards(TenantGuard)
export class ReferenceController {
  constructor(private readonly reference: ListReferenceData) {}

  @Get('dealerships')
  @ApiOkResponse({ type: [DealershipResponse] })
  @ApiUnprocessableEntityResponse({
    type: ProblemResponse,
    description: 'Missing or invalid identity headers',
  })
  async dealerships(@Tenant() ctx: TenantContext): Promise<DealershipResponse[]> {
    return (await this.reference.dealerships(ctx)).map(toDealershipResponse);
  }

  @Get('service-types')
  @ApiOkResponse({ type: [ServiceTypeResponse] })
  @ApiUnprocessableEntityResponse({
    type: ProblemResponse,
    description: 'Missing or invalid identity headers',
  })
  async serviceTypes(@Tenant() ctx: TenantContext): Promise<ServiceTypeResponse[]> {
    return (await this.reference.serviceTypes(ctx)).map(toServiceTypeResponse);
  }

  @Get('dealerships/:dealershipId/technicians')
  @ApiOkResponse({ type: [TechnicianResponse] })
  @ApiNotFoundResponse({ type: ProblemResponse })
  async technicians(@Site() ctx: SiteContext): Promise<TechnicianResponse[]> {
    return (await this.reference.technicians(ctx)).map(toTechnicianResponse);
  }

  @Get('dealerships/:dealershipId/service-bays')
  @ApiOkResponse({ type: [ServiceBayResponse] })
  @ApiNotFoundResponse({ type: ProblemResponse })
  async serviceBays(@Site() ctx: SiteContext): Promise<ServiceBayResponse[]> {
    return (await this.reference.serviceBays(ctx)).map(toServiceBayResponse);
  }
}
