import { DateTime } from 'luxon';
import {
  BAY,
  CUSTOMER,
  DEALERSHIP,
  TECHNICIAN,
  VEHICLE,
} from '../../src/infrastructure/persistence/seed/fixtures';
import { asAcme, asBeta, createTestApp, TestApp } from '../setup/app';
import { truncateTransactional } from '../setup/db';
import { at, futureWeekday, insertAppointment, LONDON } from '../setup/scheduling';

describe('US5: day view (FR-020)', () => {
  let t: TestApp;
  // A summer (BST, UTC+1) date makes local vs UTC day boundaries observable.
  const year = DateTime.now().setZone(LONDON).plus({ days: 30 }).year + 1;
  const summer = DateTime.fromObject({ year, month: 7, day: 15 }, { zone: LONDON }).toISODate()!;
  const nextDay = DateTime.fromISO(summer).plus({ days: 1 }).toISODate()!;
  const day = futureWeekday(11);
  const list = (date: string, query: Record<string, string | number> = {}, headers = asAcme()) =>
    t.http
      .get(`/api/v1/dealerships/${DEALERSHIP.LEEDS}/appointments`)
      .query({ date, ...query })
      .set(headers);
  const ids = (res: { body: { items: { id: string }[] } }) => res.body.items.map((i) => i.id);

  beforeAll(async () => {
    t = await createTestApp({ logLevel: 'warn' });
  });
  afterAll(() => t.close());
  beforeEach(truncateTransactional);

  it('AS1: only this dealership and this LOCAL date, ordered by start (00:30 BST counts as that local day)', async () => {
    const lateNight = await insertAppointment({
      technicianId: TECHNICIAN.LEEDS_ALEX,
      serviceBayId: BAY.LEEDS_LIFT,
      start: at(nextDay, '00:30'),
      end: at(nextDay, '01:00'),
    });
    const morning = await insertAppointment({
      technicianId: TECHNICIAN.LEEDS_BELLA,
      serviceBayId: BAY.LEEDS_ALIGN,
      start: at(summer, '09:00'),
      end: at(summer, '09:30'),
      vehicleId: VEHICLE.JONES_LEAF,
      customerId: CUSTOMER.BEN_JONES,
    });
    const early = await insertAppointment({
      technicianId: TECHNICIAN.LEEDS_CARL,
      serviceBayId: BAY.LEEDS_EV,
      start: at(summer, '08:00'),
      end: at(summer, '08:30'),
    });
    await insertAppointment({
      dealershipId: DEALERSHIP.YORK,
      technicianId: TECHNICIAN.YORK_ELI,
      serviceBayId: BAY.YORK_1,
      start: at(summer, '09:00'),
      end: at(summer, '09:30'),
      vehicleId: VEHICLE.SMITH_GOLF,
      customerId: CUSTOMER.ALICE_SMITH,
    });

    expect(ids(await list(summer).expect(200))).toEqual([early, morning]);
    // 00:30 BST on nextDay is 23:30Z on `summer` in UTC, but belongs to nextDay locally.
    expect(ids(await list(nextDay).expect(200))).toEqual([lateNight]);
  });

  it('filters by status and technician', async () => {
    const a = await insertAppointment({
      technicianId: TECHNICIAN.LEEDS_ALEX,
      serviceBayId: BAY.LEEDS_LIFT,
      start: at(day, '09:00'),
      end: at(day, '09:30'),
    });
    const b = await insertAppointment({
      technicianId: TECHNICIAN.LEEDS_BELLA,
      serviceBayId: BAY.LEEDS_ALIGN,
      start: at(day, '10:00'),
      end: at(day, '10:30'),
      status: 'CANCELLED',
      vehicleId: VEHICLE.JONES_LEAF,
      customerId: CUSTOMER.BEN_JONES,
    });
    expect(ids(await list(day, { status: 'CANCELLED' }).expect(200))).toEqual([b]);
    expect(ids(await list(day, { technicianId: TECHNICIAN.LEEDS_ALEX }).expect(200))).toEqual([a]);
    expect(ids(await list(day).expect(200))).toEqual([a, b]);
  });

  it('cursor paging returns every row exactly once in (start, id) order', async () => {
    const created: string[] = [];
    const techs = [TECHNICIAN.LEEDS_ALEX, TECHNICIAN.LEEDS_BELLA, TECHNICIAN.LEEDS_CARL];
    for (let i = 0; i < 7; i++) {
      const hour = String(9 + Math.floor(i / 3)).padStart(2, '0');
      created.push(
        await insertAppointment({
          technicianId: techs[i % 3],
          serviceBayId: [BAY.LEEDS_LIFT, BAY.LEEDS_ALIGN, BAY.LEEDS_EV][i % 3],
          start: at(day, `${hour}:00`),
          end: at(day, `${hour}:30`),
          vehicleId: [VEHICLE.SMITH_GOLF, VEHICLE.JONES_LEAF, VEHICLE.BROWN_FIESTA][i % 3],
          customerId: [CUSTOMER.ALICE_SMITH, CUSTOMER.BEN_JONES, CUSTOMER.CHLOE_BROWN][i % 3],
        }),
      );
    }
    const all = ids(await list(day, { limit: 100 }).expect(200));
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const res = await list(day, { limit: 3, ...(cursor ? { cursor } : {}) }).expect(200);
      seen.push(...ids(res));
      cursor = res.body.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toEqual(all);
    expect(new Set(seen)).toEqual(new Set(created));
  });

  it('invalid cursor / limit → 422; another tenant → 404', async () => {
    expect((await list(day, { cursor: 'garbage' }).expect(422)).body.code).toBe(
      'VALIDATION_FAILED',
    );
    expect((await list(day, { limit: 500 }).expect(422)).body.code).toBe('VALIDATION_FAILED');
    await list(day, {}, asBeta()).expect(404);
  });
});
