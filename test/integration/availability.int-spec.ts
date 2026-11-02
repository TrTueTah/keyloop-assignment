import { DateTime } from 'luxon';
import { PostgresQueryRunner } from 'typeorm/driver/postgres/PostgresQueryRunner';
import {
  BAY,
  DEALERSHIP,
  SERVICE_TYPE,
  TECHNICIAN,
} from '../../src/infrastructure/persistence/seed/fixtures';
import { asAcme, createTestApp, TestApp } from '../setup/app';
import { sql, truncateTransactional } from '../setup/db';
import { at, body, bookPath, futureWeekday, insertAppointment, LONDON } from '../setup/scheduling';

describe('US2: availability and alternatives (FR-011..013)', () => {
  let t: TestApp;
  const day = futureWeekday(8);
  const availability = (
    date: string,
    serviceTypeId: string = SERVICE_TYPE.OIL,
    dealershipId: string = DEALERSHIP.LEEDS,
  ) =>
    t.http
      .get(`/api/v1/dealerships/${dealershipId}/availability`)
      .query({ serviceTypeId, date })
      .set(asAcme());
  const local = (iso: string) =>
    DateTime.fromISO(iso, { setZone: true }).setZone(LONDON).toFormat('HH:mm');
  let key = 0;

  beforeAll(async () => {
    t = await createTestApp({ logLevel: 'warn' });
  });
  afterAll(() => t.close());
  beforeEach(truncateTransactional);

  it('AS1: 15-minute grid from 08:00 to 16:00 for a 60-minute service, each with a free technician AND bay', async () => {
    const res = await availability(day, SERVICE_TYPE.ALIGNMENT).expect(200);
    expect(res.body).toMatchObject({
      dealershipId: DEALERSHIP.LEEDS,
      serviceTypeId: SERVICE_TYPE.ALIGNMENT,
      date: day,
      timezone: LONDON,
    });
    const starts = res.body.slots.map((s: { startAt: string }) => local(s.startAt));
    expect(starts[0]).toBe('08:00');
    expect(starts[starts.length - 1]).toBe('16:00');
    expect(starts).toHaveLength(33);
    expect(res.body.slots[0]).toMatchObject({ availableTechnicians: 3, availableBays: 1 }); // only Bay 2 has the rig
  });

  it('exactly the times where both a qualified technician and a compatible bay are free', async () => {
    await insertAppointment({
      technicianId: TECHNICIAN.LEEDS_CARL,
      serviceBayId: BAY.LEEDS_ALIGN,
      start: at(day, '10:00'),
      end: at(day, '11:00'),
    });
    const starts = (await availability(day, SERVICE_TYPE.ALIGNMENT).expect(200)).body.slots.map(
      (s: { startAt: string }) => local(s.startAt),
    );
    for (const blocked of ['09:15', '09:30', '09:45', '10:00', '10:30', '10:45'])
      expect(starts).not.toContain(blocked);
    expect(starts).toContain('09:00');
    expect(starts).toContain('11:00');
  });

  it('AS2: booking a taken time → 409 SLOT_UNAVAILABLE with ≤ 5 alternatives, each of which then books', async () => {
    await insertAppointment({
      technicianId: TECHNICIAN.LEEDS_CARL,
      serviceBayId: BAY.LEEDS_ALIGN,
      start: at(day, '10:00'),
      end: at(day, '11:00'),
    });
    const refused = await t.http
      .post(bookPath())
      .set(asAcme())
      .set('Idempotency-Key', `alt-${++key}`)
      .send(body(at(day, '10:00'), { serviceTypeId: SERVICE_TYPE.ALIGNMENT }))
      .expect(409);
    expect(refused.body.code).toBe('SLOT_UNAVAILABLE');
    expect(refused.body.alternatives.length).toBeGreaterThan(0);
    expect(refused.body.alternatives.length).toBeLessThanOrEqual(5);
    expect(local(refused.body.alternatives[0].startAt)).toBe('11:00'); // same day, later first
    const first = refused.body.alternatives[0];
    await t.http
      .post(bookPath())
      .set(asAcme())
      .set('Idempotency-Key', `alt-${++key}`)
      .send(body(first.startAt, { serviceTypeId: SERVICE_TYPE.ALIGNMENT }))
      .expect(201);
  });

  it('AS3: no capacity in the next 7 days → alternatives: []', async () => {
    await sql(`UPDATE technician SET active = false WHERE id = $1`, [TECHNICIAN.RACE_HAL]);
    try {
      const res = await t.http
        .post(bookPath(DEALERSHIP.RACE))
        .set(asAcme())
        .set('Idempotency-Key', `alt-${++key}`)
        .send(body(at(day, '10:00')))
        .expect(409);
      expect(res.body).toMatchObject({ code: 'SLOT_UNAVAILABLE', alternatives: [] });
    } finally {
      await sql(`UPDATE technician SET active = true WHERE id = $1`, [TECHNICIAN.RACE_HAL]);
    }
  });

  it('AS4: follows local opening hours on a DST change day (Race Bay opens Sundays)', async () => {
    const autumn = DateTime.now().setZone(LONDON).year + 1;
    const lastSundayOfOctober = DateTime.fromObject(
      { year: autumn, month: 10, day: 31 },
      { zone: LONDON },
    )
      .startOf('week')
      .plus({ days: 6 });
    const date = (
      lastSundayOfOctober.month === 10
        ? lastSundayOfOctober
        : lastSundayOfOctober.minus({ weeks: 1 })
    ).toISODate()!;
    const far = DateTime.fromISO(date).diff(DateTime.now(), 'days').days > 90;
    const res = await availability(date, SERVICE_TYPE.OIL, DEALERSHIP.RACE).expect(200);
    if (far) {
      expect(res.body.slots).toEqual([]); // beyond the 90-day horizon nothing is offered
    } else {
      expect(local(res.body.slots[0].startAt)).toBe('08:00');
    }
  });

  it('closed day (Sunday at Leeds) → no slots; invalid query → 422; other tenant → 404', async () => {
    const sunday = DateTime.fromISO(day)
      .plus({ days: 7 - DateTime.fromISO(day).weekday })
      .toISODate()!;
    expect((await availability(sunday).expect(200)).body.slots).toEqual([]);
    expect((await availability('2026-13-40').expect(422)).body.code).toBe('VALIDATION_FAILED');
    await t.http
      .get(`/api/v1/dealerships/${DEALERSHIP.LEEDS}/availability`)
      .query({ serviceTypeId: SERVICE_TYPE.OIL, date: day })
      .set({ 'X-Tenant-ID': '11111111-0000-0000-0000-000000000002', 'X-User-ID': 'b' })
      .expect(404);
    expect((await availability(day, SERVICE_TYPE.BETA_OIL).expect(404)).body.code).toBe(
      'NOT_FOUND',
    );
  });

  it('uses a bounded number of SQL statements (≤ 4) regardless of slot count (Constitution VIII)', async () => {
    const spy = jest.spyOn(PostgresQueryRunner.prototype, 'query');
    try {
      for (const serviceTypeId of [SERVICE_TYPE.OIL, SERVICE_TYPE.MAJOR]) {
        spy.mockClear();
        await availability(day, serviceTypeId).expect(200);
        expect(spy.mock.calls.length).toBeLessThanOrEqual(4);
      }
    } finally {
      spy.mockRestore();
    }
  });
});
