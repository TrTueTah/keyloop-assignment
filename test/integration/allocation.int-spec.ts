import { DateTime } from 'luxon';
import {
  BAY,
  CUSTOMER,
  SERVICE_TYPE,
  TECHNICIAN,
  VEHICLE,
} from '../../src/infrastructure/persistence/seed/fixtures';
import { asAcme, createTestApp, TestApp } from '../setup/app';
import { truncateTransactional } from '../setup/db';
import { at, body, bookPath, futureWeekday, insertAppointment } from '../setup/scheduling';

describe('US1: least-loaded allocation (A11, FR-008)', () => {
  let t: TestApp;
  const day = futureWeekday(4);
  let key = 0;
  const post = (b: object) =>
    t.http.post(bookPath()).set(asAcme()).set('Idempotency-Key', `alloc-${++key}`).send(b);

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(truncateTransactional);

  it('AS4: assigns the technician and the bay with the fewest booked minutes that local day', async () => {
    // Alex 120 min, Bella 60 min, Carl 0 min; LIFT bay 180 min (via the jobs below), ALIGN/EV 0 min.
    await insertAppointment({
      technicianId: TECHNICIAN.LEEDS_ALEX,
      serviceBayId: BAY.LEEDS_LIFT,
      start: at(day, '08:00'),
      end: at(day, '10:00'),
    });
    await insertAppointment({
      technicianId: TECHNICIAN.LEEDS_BELLA,
      serviceBayId: BAY.LEEDS_LIFT,
      start: at(day, '13:00'),
      end: at(day, '14:00'),
      vehicleId: VEHICLE.JONES_LEAF,
      customerId: CUSTOMER.BEN_JONES,
    });
    const res = await post(body(at(day, '10:30'))).expect(201);
    expect(res.body.technicianId).toBe(TECHNICIAN.LEEDS_CARL);
    expect(res.body.serviceBayId).not.toBe(BAY.LEEDS_LIFT); // LIFT is the most loaded bay
  });

  it('AS5: equal load → the bay WITHOUT unneeded specialist equipment wins', async () => {
    const res = await post(body(at(day, '10:00'))).expect(201);
    expect(res.body.serviceBayId).toBe(BAY.LEEDS_LIFT); // 1 capability vs 2 for ALIGN/EV
  });

  it('only counts appointments on the dealership-LOCAL day', async () => {
    // A job the previous evening must not count toward today's load.
    const previousDay = DateTime.fromISO(day).minus({ days: 1 }).toISODate()!;
    await insertAppointment({
      technicianId: TECHNICIAN.LEEDS_ALEX,
      serviceBayId: BAY.LEEDS_LIFT,
      start: at(previousDay, '20:00'),
      end: at(previousDay, '23:30'),
    });
    await insertAppointment({
      technicianId: TECHNICIAN.LEEDS_BELLA,
      serviceBayId: BAY.LEEDS_LIFT,
      start: at(day, '08:00'),
      end: at(day, '08:30'),
      vehicleId: VEHICLE.JONES_LEAF,
      customerId: CUSTOMER.BEN_JONES,
    });
    await insertAppointment({
      technicianId: TECHNICIAN.LEEDS_CARL,
      serviceBayId: BAY.LEEDS_ALIGN,
      start: at(day, '08:00'),
      end: at(day, '08:30'),
    });
    const res = await post(body(at(day, '11:00'))).expect(201);
    expect(res.body.technicianId).toBe(TECHNICIAN.LEEDS_ALEX);
  });

  it('SC-007: a day of mixed auto-assigned services keeps the technician-load spread ≤ the longest duration', async () => {
    const plan: [string, string, number][] = [
      ['08:00', SERVICE_TYPE.OIL, 30],
      ['08:30', SERVICE_TYPE.MAJOR, 180],
      ['11:30', SERVICE_TYPE.OIL, 30],
      ['12:00', SERVICE_TYPE.MAJOR, 180],
      ['15:00', SERVICE_TYPE.OIL, 30],
      ['15:30', SERVICE_TYPE.OIL, 30],
      ['16:00', SERVICE_TYPE.OIL, 30],
    ];
    const load = new Map<string, number>(
      [TECHNICIAN.LEEDS_ALEX, TECHNICIAN.LEEDS_BELLA, TECHNICIAN.LEEDS_CARL].map((id) => [id, 0]),
    );
    for (const [time, serviceTypeId, minutes] of plan) {
      const res = await post(body(at(day, time), { serviceTypeId })).expect(201);
      load.set(res.body.technicianId, (load.get(res.body.technicianId) ?? 0) + minutes);
    }
    const values = [...load.values()];
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(180);
  });
});
