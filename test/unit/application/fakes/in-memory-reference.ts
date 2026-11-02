// NOT evidence for DB guarantees (Constitution III): orchestration-only test double.
import {
  CustomerVehicleCheck,
  ReferenceQuery,
} from '../../../../src/application/ports/reference.query';
import { SiteContext, TenantContext } from '../../../../src/application/tenant-context';
import { Dealership } from '../../../../src/domain/model/dealership';
import { ServiceBay } from '../../../../src/domain/model/service-bay';
import { ServiceType } from '../../../../src/domain/model/service-type';
import { Technician } from '../../../../src/domain/model/technician';
import { SEED } from '../../../../src/infrastructure/persistence/seed/fixtures';

const skillCode = (id: string) => SEED.skills.find((s) => s.id === id)!.code;

export const dealerships: Dealership[] = SEED.dealerships.map((d) => ({
  ...d,
  openingHours: SEED.openingHours.filter((h) => h.dealershipId === d.id),
}));
export const serviceTypes: ServiceType[] = SEED.serviceTypes.map((s) => ({
  id: s.id,
  tenantId: s.tenantId,
  code: s.code,
  name: s.name,
  durationMinutes: s.durationMinutes,
  requiredSkill: skillCode(s.requiredSkillId),
  requiredCapabilities: s.capabilities,
}));
export const technicians: Technician[] = SEED.technicians.map((t) => ({
  id: t.id,
  dealershipId: t.dealershipId,
  name: t.name,
  active: t.active,
  skills: t.skillIds.map(skillCode),
}));
export const bays: ServiceBay[] = SEED.bays.map((b) => ({ ...b }));
const tenantOf = (dealershipId: string) =>
  SEED.dealerships.find((d) => d.id === dealershipId)?.tenantId;

export class InMemoryReference implements ReferenceQuery {
  async findDealershipInTenant(tenantId: string, dealershipId: string) {
    return dealerships.find((d) => d.id === dealershipId && d.tenantId === tenantId) ?? null;
  }
  async getServiceType(ctx: TenantContext, id: string) {
    return serviceTypes.find((s) => s.id === id && s.tenantId === ctx.tenantId) ?? null;
  }
  async checkCustomerVehicle(
    ctx: TenantContext,
    customerId: string,
    vehicleId: string,
  ): Promise<CustomerVehicleCheck> {
    const customer = SEED.customers.find((c) => c.id === customerId && c.tenantId === ctx.tenantId);
    const vehicle = SEED.vehicles.find((v) => v.id === vehicleId && v.tenantId === ctx.tenantId);
    return {
      customerExists: !!customer,
      vehicleExists: !!vehicle,
      ownedByCustomer: !!vehicle && vehicle.customerId === customerId,
    };
  }
  async listDealerships(ctx: TenantContext) {
    return dealerships.filter((d) => d.tenantId === ctx.tenantId);
  }
  async listServiceTypes(ctx: TenantContext) {
    return serviceTypes.filter((s) => s.tenantId === ctx.tenantId);
  }
  async listTechnicians(ctx: SiteContext) {
    return technicians.filter((t) => t.dealershipId === ctx.dealershipId);
  }
  async listBays(ctx: SiteContext) {
    return bays.filter((b) => b.dealershipId === ctx.dealershipId);
  }
  /** Helpers for the in-memory resource fake. */
  static technician(ctx: TenantContext, id: string) {
    const t = technicians.find((x) => x.id === id);
    return t && tenantOf(t.dealershipId) === ctx.tenantId ? t : null;
  }
  static bay(ctx: TenantContext, id: string) {
    const b = bays.find((x) => x.id === id);
    return b && tenantOf(b.dealershipId) === ctx.tenantId ? b : null;
  }
}
