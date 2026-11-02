import { DEALERSHIP, SERVICE_TYPE } from '../../src/infrastructure/persistence/seed/fixtures';
import { asAcme, asBeta, createTestApp, TestApp } from '../setup/app';
import { sql, truncateTransactional } from '../setup/db';
import { at, body, bookPath, futureWeekday } from '../setup/scheduling';

describe('US3: cancel and free capacity (FR-018, FR-019)', () => {
  let t: TestApp;
  const day = futureWeekday(9);
  let key = 0;
  const book = (start: string, dealershipId: string = DEALERSHIP.RACE) =>
    t.http
      .post(bookPath(dealershipId))
      .set(asAcme())
      .set('Idempotency-Key', `cancel-${++key}`)
      .send(body(start, { serviceTypeId: SERVICE_TYPE.OIL }));
  const cancel = (id: string, version: number, headers = asAcme('advisor-2')) =>
    t.http
      .post(`${bookPath(DEALERSHIP.RACE)}/${id}/cancel`)
      .set(headers)
      .send({ version });

  beforeAll(async () => {
    t = await createTestApp({ logLevel: 'warn' });
  });
  afterAll(() => t.close());
  beforeEach(truncateTransactional);

  it('AS1: cancelled, version +1, the slot reappears in availability and can be rebooked', async () => {
    const booked = (await book(at(day, '10:00')).expect(201)).body;
    await book(at(day, '10:00')).expect(409); // Race Bay has one technician + one bay

    const res = await cancel(booked.id, 1).expect(200);
    expect(res.body).toMatchObject({ id: booked.id, status: 'CANCELLED', version: 2 });

    const slots = (
      await t.http
        .get(`/api/v1/dealerships/${DEALERSHIP.RACE}/availability`)
        .query({ serviceTypeId: SERVICE_TYPE.OIL, date: day })
        .set(asAcme())
        .expect(200)
    ).body.slots.map((s: { startAt: string }) => s.startAt);
    expect(slots).toContain(booked.startAt);
    await book(at(day, '10:00')).expect(201);

    const events = await sql<{ type: string; actor: string }>(
      `SELECT type, actor FROM appointment_event WHERE appointment_id = $1 ORDER BY occurred_at`,
      [booked.id],
    );
    expect(events).toEqual([
      { type: 'CREATED', actor: 'advisor-1' },
      { type: 'CANCELLED', actor: 'advisor-2' },
    ]);
  });

  it('AS2: cancelling again → 409 NOT_CONFIRMED', async () => {
    const booked = (await book(at(day, '11:00')).expect(201)).body;
    await cancel(booked.id, 1).expect(200);
    expect((await cancel(booked.id, 2).expect(409)).body.code).toBe('NOT_CONFIRMED');
  });

  it('AS3: a cancellation based on an outdated version → 409 STALE_VERSION', async () => {
    const booked = (await book(at(day, '12:00')).expect(201)).body;
    await sql(`UPDATE appointment SET version = version + 1 WHERE id = $1`, [booked.id]); // someone else changed it
    expect((await cancel(booked.id, 1).expect(409)).body.code).toBe('STALE_VERSION');
  });

  it('another tenant → 404; unknown id → 404; bad version → 422', async () => {
    const booked = (await book(at(day, '13:00')).expect(201)).body;
    await cancel(booked.id, 1, asBeta()).expect(404);
    await cancel('00000000-0000-4000-8000-000000000000', 1).expect(404);
    expect((await cancel(booked.id, 0).expect(422)).body.code).toBe('VALIDATION_FAILED');
  });
});
