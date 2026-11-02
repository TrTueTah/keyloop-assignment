import { sql } from '../setup/db';

/**
 * Guards Constitution V ("migrations MUST NOT silently drop the exclusion constraints or composite
 * FKs"): asserts the correctness-critical constraints exist with the expected definitions.
 */
describe('schema (after migrations)', () => {
  const constraintDef = async (name: string) => {
    const rows = await sql<{ def: string; type: string }>(
      `SELECT pg_get_constraintdef(c.oid) AS def, c.contype AS type
         FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'appointment' AND c.conname = $1`,
      [name],
    );
    return rows[0];
  };

  it('has btree_gist installed', async () => {
    const rows = await sql(`SELECT 1 FROM pg_extension WHERE extname = 'btree_gist'`);
    expect(rows).toHaveLength(1);
  });

  it.each([
    ['no_technician_overlap', 'technician_id'],
    ['no_bay_overlap', 'service_bay_id'],
    ['no_vehicle_overlap', 'vehicle_id'],
  ])('%s is a partial gist exclusion on %s over a half-open tstzrange', async (name, column) => {
    const c = await constraintDef(name);
    expect(c?.type).toBe('x');
    expect(c.def).toContain('EXCLUDE USING gist');
    expect(c.def).toContain(`${column} WITH =`);
    expect(c.def).toContain(`tstzrange(start_at, end_at, '[)'::text) WITH &&`);
    expect(c.def).toContain(`WHERE ((status = 'CONFIRMED'::text))`);
  });

  it.each([
    ['fk_appt_site', '(dealership_id, tenant_id) REFERENCES dealership(id, tenant_id)'],
    ['fk_appt_tech', '(technician_id, dealership_id) REFERENCES technician(id, dealership_id)'],
    ['fk_appt_bay', '(service_bay_id, dealership_id) REFERENCES service_bay(id, dealership_id)'],
    ['fk_appt_customer', '(customer_id, tenant_id) REFERENCES customer(id, tenant_id)'],
    ['fk_appt_vehicle', '(vehicle_id, tenant_id) REFERENCES vehicle(id, tenant_id)'],
    ['fk_appt_service', '(service_type_id, tenant_id) REFERENCES service_type(id, tenant_id)'],
  ])('composite FK %s exists', async (name, expected) => {
    const c = await constraintDef(name);
    expect(c?.type).toBe('f');
    expect(c.def).toBe(`FOREIGN KEY ${expected}`);
  });

  it('has the per-tenant idempotency unique index', async () => {
    const rows = await sql<{ def: string }>(
      `SELECT indexdef AS def FROM pg_indexes WHERE indexname = 'uq_appt_idempotency'`,
    );
    expect(rows[0]?.def).toContain(
      'UNIQUE INDEX uq_appt_idempotency ON public.appointment USING btree (tenant_id, idempotency_key)',
    );
  });

  it('does not create the designed-only resource_unavailability table (Constitution VIII)', async () => {
    const rows = await sql(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'resource_unavailability'`,
    );
    expect(rows).toHaveLength(0);
  });
});
