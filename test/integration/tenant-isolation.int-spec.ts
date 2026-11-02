import { sql, truncateTransactional } from '../setup/db';
import {
  CUSTOMER,
  DEALERSHIP,
  SERVICE_TYPE,
  TECHNICIAN,
  BAY,
  TENANT,
  VEHICLE,
} from '../../src/infrastructure/persistence/seed/fixtures';

/** A valid Acme Leeds appointment row; individual tests swap one reference to break isolation. */
const baseRow = {
  tenant_id: TENANT.ACME,
  dealership_id: DEALERSHIP.LEEDS,
  customer_id: CUSTOMER.ALICE_SMITH,
  vehicle_id: VEHICLE.SMITH_GOLF,
  service_type_id: SERVICE_TYPE.OIL,
  technician_id: TECHNICIAN.LEEDS_BELLA,
  service_bay_id: BAY.LEEDS_LIFT,
};

async function insertRaw(overrides: Partial<typeof baseRow>, key: string) {
  const r = { ...baseRow, ...overrides };
  return sql(
    `INSERT INTO appointment (tenant_id, dealership_id, customer_id, vehicle_id, service_type_id,
        technician_id, service_bay_id, start_at, end_at, status, assignment_mode, created_by,
        idempotency_key, request_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7, '2030-01-07T10:00:00Z', '2030-01-07T10:30:00Z', 'CONFIRMED', 'AUTO',
        'test', $8, repeat('0', 64))`,
    [
      r.tenant_id,
      r.dealership_id,
      r.customer_id,
      r.vehicle_id,
      r.service_type_id,
      r.technician_id,
      r.service_bay_id,
      key,
    ],
  );
}

describe('tenant isolation', () => {
  beforeEach(truncateTransactional);

  describe('database-level (composite FKs reject bad rows even if application code is wrong)', () => {
    it('accepts a fully consistent row (control)', async () => {
      await expect(insertRaw({}, 'ok')).resolves.toBeDefined();
    });

    it.each([
      ['another site’s technician', { technician_id: TECHNICIAN.YORK_ELI }, 'fk_appt_tech'],
      ['another site’s bay', { service_bay_id: BAY.YORK_1 }, 'fk_appt_bay'],
      ['another tenant’s vehicle', { vehicle_id: VEHICLE.BETA_CIVIC }, 'fk_appt_vehicle'],
      ['another tenant’s customer', { customer_id: CUSTOMER.BETA_DAVID }, 'fk_appt_customer'],
      [
        'another tenant’s service type',
        { service_type_id: SERVICE_TYPE.BETA_OIL },
        'fk_appt_service',
      ],
      ['a dealership/tenant mismatch', { dealership_id: DEALERSHIP.BETA_HQ }, 'fk_appt_site'],
    ])('rejects %s via %s', async (_label, overrides, constraint) => {
      await expect(insertRaw(overrides, `bad-${constraint}`)).rejects.toMatchObject({ constraint });
    });
  });
});

import { asAcme, asBeta, createTestApp, TestApp } from '../setup/app';
import { at, body, bookPath, futureWeekday } from '../setup/scheduling';

describe('tenant isolation: api-level (SC-006)', () => {
  let t: TestApp;
  const day = futureWeekday(7);
  beforeAll(async () => {
    t = await createTestApp({ logLevel: 'warn' });
  });
  afterAll(() => t.close());
  beforeEach(truncateTransactional);

  const expectNotFound = (res: { status: number; body: { code: string; title: string } }) => {
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND', title: 'Resource not found' });
  };

  it('Beta cannot book at an Acme dealership (indistinguishable from a missing dealership)', async () => {
    const res = await t.http
      .post(bookPath(DEALERSHIP.LEEDS))
      .set(asBeta())
      .set('Idempotency-Key', 'x')
      .send(body(at(day, '10:00')));
    expectNotFound(res);
    const missing = await t.http
      .post(bookPath('22222222-0000-0000-0000-000000000099'))
      .set(asBeta())
      .set('Idempotency-Key', 'y')
      .send(body(at(day, '10:00')));
    expect(missing.body.code).toBe(res.body.code);
    expect(missing.body.title).toBe(res.body.title);
  });

  it.each([
    ['vehicle', { vehicleId: VEHICLE.BETA_CIVIC }],
    ['customer', { customerId: CUSTOMER.BETA_DAVID, vehicleId: VEHICLE.BETA_CIVIC }],
    ['service type', { serviceTypeId: SERVICE_TYPE.BETA_OIL }],
  ])('Acme cannot reference Beta’s %s → 404', async (_label, over) => {
    const res = await t.http
      .post(bookPath())
      .set(asAcme())
      .set('Idempotency-Key', `iso-${_label.replace(/\s/g, '-')}`)
      .send(body(at(day, '10:00'), over));
    expectNotFound(res);
  });

  it('Beta cannot read an Acme appointment', async () => {
    const created = await t.http
      .post(bookPath())
      .set(asAcme())
      .set('Idempotency-Key', 'iso-read')
      .send(body(at(day, '10:00')))
      .expect(201);
    expectNotFound(await t.http.get(created.headers.location).set(asBeta()));
  });
});
