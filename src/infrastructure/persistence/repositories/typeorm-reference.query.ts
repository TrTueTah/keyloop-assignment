import { EntityManager } from 'typeorm';
import { CustomerVehicleCheck, ReferenceQuery } from '../../../application/ports/reference.query';
import { SiteContext, TenantContext } from '../../../application/tenant-context';
import { Dealership, OpeningHours } from '../../../domain/model/dealership';
import { ServiceBay } from '../../../domain/model/service-bay';
import { ServiceType } from '../../../domain/model/service-type';
import { Technician } from '../../../domain/model/technician';
import { isUuid, queryRows } from './sql';

interface DealershipRow {
  id: string;
  tenant_id: string;
  name: string;
  timezone: string;
  hours: OpeningHours[];
}
interface ServiceTypeRow {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  duration_minutes: number;
  required_skill: string;
  capabilities: string[];
}

const DEALERSHIP_SQL = `
  SELECT d.id, d.tenant_id, d.name, d.timezone,
         COALESCE((SELECT json_agg(json_build_object(
                     'weekday', h.weekday,
                     'opensAt', to_char(h.opens_at, 'HH24:MI'),
                     'closesAt', to_char(h.closes_at, 'HH24:MI')) ORDER BY h.weekday)
                     FROM opening_hours h WHERE h.dealership_id = d.id), '[]'::json) AS hours
    FROM dealership d`;

const SERVICE_TYPE_SQL = `
  SELECT st.id, st.tenant_id, st.code, st.name, st.duration_minutes, s.code AS required_skill,
         COALESCE(ARRAY(SELECT c.capability_code FROM service_type_capability c
                         WHERE c.service_type_id = st.id ORDER BY c.capability_code), '{}') AS capabilities
    FROM service_type st JOIN skill s ON s.id = st.required_skill_id`;

const toDealership = (r: DealershipRow): Dealership => ({
  id: r.id,
  tenantId: r.tenant_id,
  name: r.name,
  timezone: r.timezone,
  openingHours: r.hours,
});

const toServiceType = (r: ServiceTypeRow): ServiceType => ({
  id: r.id,
  tenantId: r.tenant_id,
  code: r.code,
  name: r.name,
  durationMinutes: r.duration_minutes,
  requiredSkill: r.required_skill,
  requiredCapabilities: r.capabilities,
});

/** Read-only reference data; every query filters by tenant (and site) (Constitution II/VIII). */
export class TypeOrmReferenceQuery implements ReferenceQuery {
  constructor(private readonly em: EntityManager) {}

  async findDealershipInTenant(tenantId: string, dealershipId: string): Promise<Dealership | null> {
    if (!isUuid(tenantId) || !isUuid(dealershipId)) return null;
    const rows = await queryRows<DealershipRow>(
      this.em,
      `${DEALERSHIP_SQL} WHERE d.id = $1 AND d.tenant_id = $2`,
      [dealershipId, tenantId],
    );
    return rows[0] ? toDealership(rows[0]) : null;
  }

  async getServiceType(ctx: TenantContext, id: string): Promise<ServiceType | null> {
    if (!isUuid(id)) return null;
    const rows = await queryRows<ServiceTypeRow>(
      this.em,
      `${SERVICE_TYPE_SQL} WHERE st.id = $1 AND st.tenant_id = $2`,
      [id, ctx.tenantId],
    );
    return rows[0] ? toServiceType(rows[0]) : null;
  }

  async checkCustomerVehicle(
    ctx: TenantContext,
    customerId: string,
    vehicleId: string,
  ): Promise<CustomerVehicleCheck> {
    if (!isUuid(customerId) || !isUuid(vehicleId)) {
      return { customerExists: false, vehicleExists: false, ownedByCustomer: false };
    }
    const rows = await queryRows<{ customer_exists: boolean; vehicle_owner: string | null }>(
      this.em,
      `SELECT EXISTS (SELECT 1 FROM customer c WHERE c.id = $1 AND c.tenant_id = $3) AS customer_exists,
              (SELECT v.customer_id FROM vehicle v WHERE v.id = $2 AND v.tenant_id = $3) AS vehicle_owner`,
      [customerId, vehicleId, ctx.tenantId],
    );
    const r = rows[0];
    return {
      customerExists: r.customer_exists,
      vehicleExists: r.vehicle_owner !== null,
      ownedByCustomer: r.vehicle_owner === customerId,
    };
  }

  async listDealerships(ctx: TenantContext): Promise<Dealership[]> {
    const rows = await queryRows<DealershipRow>(
      this.em,
      `${DEALERSHIP_SQL} WHERE d.tenant_id = $1 ORDER BY d.name`,
      [ctx.tenantId],
    );
    return rows.map(toDealership);
  }

  async listServiceTypes(ctx: TenantContext): Promise<ServiceType[]> {
    const rows = await queryRows<ServiceTypeRow>(
      this.em,
      `${SERVICE_TYPE_SQL} WHERE st.tenant_id = $1 ORDER BY st.name`,
      [ctx.tenantId],
    );
    return rows.map(toServiceType);
  }

  async listTechnicians(ctx: SiteContext): Promise<Technician[]> {
    const rows = await queryRows<{
      id: string;
      dealership_id: string;
      name: string;
      active: boolean;
      skills: string[];
    }>(
      this.em,
      `SELECT t.id, t.dealership_id, t.name, t.active,
              COALESCE(ARRAY(SELECT s.code FROM technician_skill ts JOIN skill s ON s.id = ts.skill_id
                              WHERE ts.technician_id = t.id ORDER BY s.code), '{}') AS skills
         FROM technician t JOIN dealership d ON d.id = t.dealership_id
        WHERE t.dealership_id = $1 AND d.tenant_id = $2 ORDER BY t.name`,
      [ctx.dealershipId, ctx.tenantId],
    );
    return rows.map((r) => ({
      id: r.id,
      dealershipId: r.dealership_id,
      name: r.name,
      active: r.active,
      skills: r.skills,
    }));
  }

  async listBays(ctx: SiteContext): Promise<ServiceBay[]> {
    const rows = await queryRows<{
      id: string;
      dealership_id: string;
      name: string;
      active: boolean;
      capabilities: string[];
    }>(
      this.em,
      `SELECT b.id, b.dealership_id, b.name, b.active,
              COALESCE(ARRAY(SELECT c.capability_code FROM service_bay_capability c
                              WHERE c.service_bay_id = b.id ORDER BY c.capability_code), '{}') AS capabilities
         FROM service_bay b JOIN dealership d ON d.id = b.dealership_id
        WHERE b.dealership_id = $1 AND d.tenant_id = $2 ORDER BY b.name`,
      [ctx.dealershipId, ctx.tenantId],
    );
    return rows.map((r) => ({
      id: r.id,
      dealershipId: r.dealership_id,
      name: r.name,
      active: r.active,
      capabilities: r.capabilities,
    }));
  }
}
