import { Dealership } from '../../domain/model/dealership';
import { ServiceBay } from '../../domain/model/service-bay';
import { ServiceType } from '../../domain/model/service-type';
import { Technician } from '../../domain/model/technician';
import { ReferenceQuery } from '../ports/reference.query';
import { SiteContext, TenantContext } from '../tenant-context';

/** FR-022: read-only reference data for the advisor's manual-assignment UI (tenant/site scoped). */
export class ListReferenceData {
  constructor(private readonly reference: ReferenceQuery) {}

  dealerships(ctx: TenantContext): Promise<Dealership[]> {
    return this.reference.listDealerships(ctx);
  }
  serviceTypes(ctx: TenantContext): Promise<ServiceType[]> {
    return this.reference.listServiceTypes(ctx);
  }
  technicians(ctx: SiteContext): Promise<Technician[]> {
    return this.reference.listTechnicians(ctx);
  }
  serviceBays(ctx: SiteContext): Promise<ServiceBay[]> {
    return this.reference.listBays(ctx);
  }
}
