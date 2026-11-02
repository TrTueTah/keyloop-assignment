import { IANAZone } from 'luxon';
import { DataSource } from 'typeorm';
import { SEED, SeedData } from './fixtures';

/**
 * Idempotent upsert of the reference dataset (reference data is seeded and read-only,
 * Constitution VIII). Safe to run on every container start.
 */
export async function seed(ds: DataSource, data: SeedData = SEED): Promise<void> {
  for (const d of data.dealerships) {
    if (!IANAZone.isValidZone(d.timezone)) {
      throw new Error(`Invalid IANA time zone for dealership ${d.id}: ${d.timezone}`);
    }
  }

  await ds.transaction(async (em) => {
    const q = (sql: string, params: unknown[]) => em.query(sql, params);

    for (const t of data.tenants) {
      await q(`INSERT INTO tenant (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [
        t.id,
        t.name,
      ]);
    }
    for (const d of data.dealerships) {
      await q(
        `INSERT INTO dealership (id, tenant_id, name, timezone) VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [d.id, d.tenantId, d.name, d.timezone],
      );
    }
    for (const h of data.openingHours) {
      await q(
        `INSERT INTO opening_hours (dealership_id, weekday, opens_at, closes_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (dealership_id, weekday) DO NOTHING`,
        [h.dealershipId, h.weekday, h.opensAt, h.closesAt],
      );
    }
    for (const s of data.skills) {
      await q(
        `INSERT INTO skill (id, tenant_id, code, name) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
        [s.id, s.tenantId, s.code, s.name],
      );
    }
    for (const c of data.capabilities) {
      await q(
        `INSERT INTO bay_capability (code, name) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING`,
        [c.code, c.name],
      );
    }
    for (const st of data.serviceTypes) {
      await q(
        `INSERT INTO service_type (id, tenant_id, code, name, duration_minutes, required_skill_id)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
        [st.id, st.tenantId, st.code, st.name, st.durationMinutes, st.requiredSkillId],
      );
      for (const cap of st.capabilities) {
        await q(
          `INSERT INTO service_type_capability (service_type_id, capability_code) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [st.id, cap],
        );
      }
    }
    for (const t of data.technicians) {
      await q(
        `INSERT INTO technician (id, dealership_id, name, active) VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [t.id, t.dealershipId, t.name, t.active],
      );
      for (const skillId of t.skillIds) {
        await q(
          `INSERT INTO technician_skill (technician_id, skill_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [t.id, skillId],
        );
      }
    }
    for (const b of data.bays) {
      await q(
        `INSERT INTO service_bay (id, dealership_id, name, active) VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [b.id, b.dealershipId, b.name, b.active],
      );
      for (const cap of b.capabilities) {
        await q(
          `INSERT INTO service_bay_capability (service_bay_id, capability_code) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [b.id, cap],
        );
      }
    }
    for (const c of data.customers) {
      await q(
        `INSERT INTO customer (id, tenant_id, name, email, phone) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [c.id, c.tenantId, c.name, c.email, c.phone],
      );
    }
    for (const v of data.vehicles) {
      await q(
        `INSERT INTO vehicle (id, tenant_id, customer_id, vin, make, model, year)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
        [v.id, v.tenantId, v.customerId, v.vin, v.make, v.model, v.year],
      );
    }
  });
}
