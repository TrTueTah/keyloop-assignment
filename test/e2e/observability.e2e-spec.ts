import { DEALERSHIP, SERVICE_TYPE } from '../../src/infrastructure/persistence/seed/fixtures';
import { asAcme, createTestApp, TestApp } from '../setup/app';
import { truncateTransactional } from '../setup/db';
import { at, body, bookPath, futureWeekday } from '../setup/scheduling';

/** Constitution VII: business metrics exist, without tenant labels; logs carry the request context. */
describe('observability', () => {
  let t: TestApp;
  const day = futureWeekday(14);

  beforeAll(async () => {
    // Start the real OTel SDK (metrics only) for this file; tests disable it by default.
    process.env.OTEL_SDK_DISABLED = 'false';
    process.env.OTEL_TRACES_EXPORTER = 'none';
    const { startTelemetry } = await import('../../src/tracing');
    startTelemetry();
    t = await createTestApp({ logLevel: 'info' });
    await truncateTransactional();
  });
  afterAll(async () => {
    await t.close();
    process.env.OTEL_SDK_DISABLED = 'true';
  });

  it('exposes booking metrics on /metrics with no tenant_id / dealership_id labels', async () => {
    await t.http
      .post(bookPath(DEALERSHIP.RACE))
      .set(asAcme())
      .set('Idempotency-Key', 'obs-1')
      .send(body(at(day, '10:00'), { serviceTypeId: SERVICE_TYPE.OIL }))
      .expect(201);
    await t.http
      .post(bookPath(DEALERSHIP.RACE))
      .set(asAcme())
      .set('Idempotency-Key', 'obs-2')
      .send(
        body(at(day, '10:00'), {
          serviceTypeId: SERVICE_TYPE.OIL,
          vehicleId: '55555555-0000-0000-0001-000000000001',
          customerId: '44444444-0000-0000-0001-000000000001',
        }),
      )
      .expect(409);
    const metrics = (await t.http.get('/metrics').expect(200)).text;
    expect(metrics).toMatch(/bookings_total\{[^}]*outcome="confirmed"/);
    expect(metrics).toMatch(/bookings_total\{[^}]*outcome="rejected"/);
    expect(metrics).toContain('booking_duration_seconds');
    expect(metrics).not.toMatch(/tenant_id=|dealership_id=/);
  });

  it('log lines carry request_id, tenant_id, dealership_id and the booking outcome', async () => {
    t.logs.length = 0;
    await t.http
      .post(bookPath(DEALERSHIP.RACE))
      .set(asAcme())
      .set('X-Request-ID', 'obs-req-1')
      .set('Idempotency-Key', 'obs-3')
      .send(body(at(day, '12:00'), { serviceTypeId: SERVICE_TYPE.OIL }))
      .expect(201);
    const lines = t.logs.map((l) => JSON.parse(l) as Record<string, unknown>);
    const business = lines.find((l) => l.msg === 'booking.completed');
    expect(business).toMatchObject({
      request_id: 'obs-req-1',
      tenant_id: asAcme()['X-Tenant-ID'],
      dealership_id: DEALERSHIP.RACE,
      outcome: 'confirmed',
    });
    const access = lines.find((l) => l.msg === 'request completed');
    expect(access).toMatchObject({ request_id: 'obs-req-1', tenant_id: asAcme()['X-Tenant-ID'], dealership_id: DEALERSHIP.RACE });
    // No duplicated JSON keys (pino-http calls customProps twice; OTel also injects trace ids).
    const raw = t.logs.find((l) => l.includes('"request completed"'))!;
    for (const key of ['request_id', 'tenant_id', 'dealership_id', 'trace_id']) {
      expect(raw.split(`"${key}":`).length - 1).toBeLessThanOrEqual(1);
    }
  });
});
