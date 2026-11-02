import {
  CUSTOMER,
  DEALERSHIP,
  SEED,
  SERVICE_TYPE,
  VEHICLE,
} from '../../src/infrastructure/persistence/seed/fixtures';
import { asAcme, createTestApp, TestApp } from '../setup/app';
import { sql, truncateTransactional } from '../setup/db';
import { at, body, bookPath, futureWeekday } from '../setup/scheduling';

/**
 * SC-010 / FR-027 / Constitution VII: no customer name, email or phone in logs, problem bodies or
 * event payloads, across a full flow including errors.
 */
describe('no PII in logs, problem bodies or events (SC-010)', () => {
  let t: TestApp;
  const day = futureWeekday(13);
  const pii = SEED.customers.flatMap((c) => [c.name, c.email, c.phone]);
  const bodies: string[] = [];

  beforeAll(async () => {
    t = await createTestApp({ logLevel: 'debug' });
    await truncateTransactional();
  });
  afterAll(() => t.close());

  it('booking → reassign → cancel → forced 409 → forced 422 leaks nothing', async () => {
    const send = async (
      req: PromiseLike<{ text: string; status: number; body: Record<string, unknown> }>,
    ) => {
      const res = await req;
      bodies.push(res.text);
      return res;
    };
    const booked = (
      await send(
        t.http
          .post(bookPath())
          .set(asAcme())
          .set('Idempotency-Key', 'pii-1')
          .send(body(at(day, '10:00'))),
      )
    ).body as {
      id: string;
      serviceBayId: string;
    };
    await send(
      t.http
        .patch(`${bookPath()}/${booked.id}/assignment`)
        .set(asAcme())
        .send({ serviceBayId: booked.serviceBayId, version: 1 }),
    );
    await send(
      t.http
        .post(bookPath())
        .set(asAcme())
        .set('Idempotency-Key', 'pii-2')
        .send(body(at(day, '10:15'))),
    ); // 409 vehicle
    await send(
      t.http
        .post(bookPath())
        .set(asAcme())
        .set('Idempotency-Key', 'pii-3')
        .send(body(at(day, '10:00'), { vehicleId: VEHICLE.JONES_LEAF })),
    ); // 422 not owned (Ben Jones' car)
    await send(
      t.http
        .post(bookPath())
        .set(asAcme())
        .set('Idempotency-Key', 'pii-4')
        .send({ ...body(at(day, '10:00')), email: 'ben.jones@example.test' }),
    ); // 422 unknown prop
    await send(t.http.post(`${bookPath()}/${booked.id}/cancel`).set(asAcme()).send({ version: 2 }));
    await send(
      t.http
        .get(`/api/v1/dealerships/${DEALERSHIP.LEEDS}/appointments`)
        .query({ date: day })
        .set(asAcme()),
    );
    await send(
      t.http
        .get(`/api/v1/dealerships/${DEALERSHIP.LEEDS}/availability`)
        .query({ date: day, serviceTypeId: SERVICE_TYPE.OIL })
        .set(asAcme()),
    );

    const events = (await sql<{ payload: unknown }>(`SELECT payload FROM appointment_event`)).map(
      (e) => JSON.stringify(e.payload),
    );
    expect(t.logs.length).toBeGreaterThan(5); // we really captured logs
    expect(events.length).toBeGreaterThanOrEqual(2);
    for (const haystack of [...t.logs, ...bodies, ...events]) {
      for (const needle of pii) expect(haystack).not.toContain(needle);
    }
    expect(CUSTOMER.ALICE_SMITH).toBeDefined();
  });
});
