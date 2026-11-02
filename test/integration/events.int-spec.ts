import { BAY, DEALERSHIP } from '../../src/infrastructure/persistence/seed/fixtures';
import { asAcme, asBeta, createTestApp, TestApp } from '../setup/app';
import { truncateTransactional } from '../setup/db';
import { at, body, bookPath, futureWeekday } from '../setup/scheduling';

describe('US5: appointment history (FR-021)', () => {
  let t: TestApp;
  const day = futureWeekday(12);
  beforeAll(async () => {
    t = await createTestApp({ logLevel: 'warn' });
  });
  afterAll(() => t.close());
  beforeEach(truncateTransactional);

  it('AS2: created → reassigned → cancelled, in time order, with actors and before/after', async () => {
    const booked = (
      await t.http
        .post(bookPath())
        .set(asAcme('advisor-a'))
        .set('Idempotency-Key', 'hist-1')
        .send(body(at(day, '10:00')))
        .expect(201)
    ).body;
    const target = booked.serviceBayId === BAY.LEEDS_ALIGN ? BAY.LEEDS_EV : BAY.LEEDS_ALIGN;
    await t.http
      .patch(`${bookPath()}/${booked.id}/assignment`)
      .set(asAcme('advisor-b'))
      .send({ serviceBayId: target, version: 1 })
      .expect(200);
    await t.http
      .post(`${bookPath()}/${booked.id}/cancel`)
      .set(asAcme('advisor-c'))
      .send({ version: 2 })
      .expect(200);

    const events = (await t.http.get(`${bookPath()}/${booked.id}/events`).set(asAcme()).expect(200))
      .body;
    expect(events.map((e: { type: string; actor: string }) => [e.type, e.actor])).toEqual([
      ['CREATED', 'advisor-a'],
      ['REASSIGNED', 'advisor-b'],
      ['CANCELLED', 'advisor-c'],
    ]);
    expect(events[1].payload).toEqual({
      before: { technicianId: booked.technicianId, serviceBayId: booked.serviceBayId },
      after: { technicianId: booked.technicianId, serviceBayId: target },
    });
    const times = events.map((e: { occurredAt: string }) => Date.parse(e.occurredAt));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('event payloads hold only ids, enums and timestamps (no customer fields)', async () => {
    const booked = (
      await t.http
        .post(bookPath())
        .set(asAcme())
        .set('Idempotency-Key', 'hist-2')
        .send(body(at(day, '11:00')))
        .expect(201)
    ).body;
    const [created] = (
      await t.http.get(`${bookPath()}/${booked.id}/events`).set(asAcme()).expect(200)
    ).body;
    expect(Object.keys(created.payload).sort()).toEqual(
      [
        'assignmentMode',
        'channel',
        'endAt',
        'serviceBayId',
        'serviceTypeId',
        'startAt',
        'technicianId',
        'vehicleId',
      ].sort(),
    );
    expect(JSON.stringify(created)).not.toMatch(/Alice|Smith|@example|\+44/);
  });

  it('another tenant’s appointment → 404; unknown → 404', async () => {
    const booked = (
      await t.http
        .post(bookPath())
        .set(asAcme())
        .set('Idempotency-Key', 'hist-3')
        .send(body(at(day, '12:00')))
        .expect(201)
    ).body;
    await t.http.get(`${bookPath()}/${booked.id}/events`).set(asBeta()).expect(404);
    await t.http
      .get(
        `/api/v1/dealerships/${DEALERSHIP.LEEDS}/appointments/00000000-0000-4000-8000-000000000000/events`,
      )
      .set(asAcme())
      .expect(404);
  });
});
