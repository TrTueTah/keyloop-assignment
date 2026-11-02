import { Dealership } from '../../domain/model/dealership';
import { ServiceBay } from '../../domain/model/service-bay';
import { ServiceType } from '../../domain/model/service-type';
import { Technician } from '../../domain/model/technician';
import { SiteContext, TenantContext } from '../tenant-context';

export interface CustomerVehicleCheck {
  readonly customerExists: boolean;
  readonly vehicleExists: boolean;
  readonly ownedByCustomer: boolean;
}

/** Read-only, seeded reference data (Constitution VIII). Every method is tenant-scoped. */
export interface ReferenceQuery {
  findDealershipInTenant(tenantId: string, dealershipId: string): Promise<Dealership | null>;
  getServiceType(ctx: TenantContext, id: string): Promise<ServiceType | null>;
  checkCustomerVehicle(
    ctx: TenantContext,
    customerId: string,
    vehicleId: string,
  ): Promise<CustomerVehicleCheck>;
  listDealerships(ctx: TenantContext): Promise<Dealership[]>;
  listServiceTypes(ctx: TenantContext): Promise<ServiceType[]>;
  listTechnicians(ctx: SiteContext): Promise<Technician[]>;
  listBays(ctx: SiteContext): Promise<ServiceBay[]>;
}
export const REFERENCE_QUERY = Symbol('REFERENCE_QUERY');
