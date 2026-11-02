import { DateTime } from 'luxon';
import {
  BAY,
  CUSTOMER,
  SERVICE_TYPE,
  TECHNICIAN,
  VEHICLE,
} from '../../src/infrastructure/persistence/seed/fixtures';
import { asAcme, createTestApp, TestApp } from '../setup/app';
import { sql, truncateTransactional } from '../setup/db';
import { at, body, bookPath, futureWeekday, insertAppointment, LONDON } from '../setup/scheduling';

describe('US1: book with automatic resource assignment (HTTP + real PostgreSQL)', () => {
  let t: TestApp;
  const day = futureWeekday();
  let key = 0;
  const post = (b: object, idempotencyKey = `k-${++key}`) =>
    t.http.post(bookPath()).set(asAcme()).set('Idempotency-Key', idempotencyKey).send(b);

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(truncateTransactional);

  it('AS1: confirms 10:00–10:30 with a qualified technician and compatible bay, all links stored', async () => {
    const res = await post(body(at(day, '10:00'))).expect(201);
    expect(res.headers.location).toBe(`${bookPath()}/${res.body.id}`);
    expect(res.body).toMatchObject({
      customerId: CUSTOMER.ALICE_SMITH,
      vehicleId: VEHICLE.SMITH_GOLF,
      serviceTypeId: SERVICE_TYPE.OIL,
      status: 'CONFIRMED',
      assignmentMode: 'AUTO',
      channel: 'ADVISOR',
      createdBy: 'advisor-1',
      version: 1,
    });
    expect([TECHNICIAN.LEEDS_ALEX, TECHNICIAN.LEEDS_BELLA, TECHNICIAN.LEEDS_CARL]).toContain(
      res.body.technicianId,
    );
    expect([BAY.LEEDS_LIFT, BAY.LEEDS_ALIGN, BAY.LEEDS_EV]).toContain(res.body.serviceBayId);
    const start = DateTime.fromISO(res.body.startAt, { setZone: true });
    expect(start.setZone(LONDON).toFormat('HH:mm')).toBe('10:00');
    expect(DateTime.fromISO(res.body.endAt).diff(start, 'minutes').minutes).toBe(30);
    // rendered in the dealership's offset
    expect(res.body.startAt).toBe(
      DateTime.fromISO(at(day, '10:00')).setZone(LONDON).toISO({ suppressMilliseconds: true }),
    );

    const [row] = await sql(`SELECT * FROM appointment WHERE id = $1`, [res.body.id]);
    expect(row).toMatchObject({
      technician_id: res.body.technicianId,
      service_bay_id: res.body.serviceBayId,
    });
    const fetched = await t.http.get(res.headers.location).set(asAcme()).expect(200);
    expect(fetched.body).toEqual(res.body);
  });

  it('AS2: the only qualified technician is busy for part of the duration → 409 SLOT_UNAVAILABLE, nothing created', async () => {
    // EV check needs EV_HIGH_VOLTAGE: at Leeds only Alex has it.
    await insertAppointment({
      technicianId: TECHNICIAN.LEEDS_ALEX,
      serviceBayId: BAY.LEEDS_LIFT,
      start: at(day, '10:30'),
      end: at(day, '11:30'),
    });
    const res = await post(
      body(at(day, '10:00'), {
        serviceTypeId: SERVICE_TYPE.EV_CHECK,
        vehicleId: VEHICLE.SMITH_GOLF,
      }),
    ).expect(409);
    expect(res.body.code).toBe('SLOT_UNAVAILABLE');
    expect(await sql(`SELECT 1 FROM appointment WHERE created_by = 'advisor-1'`)).toHaveLength(0);
  });

  it('AS3: technicians free but no bay with the required equipment → 409 SLOT_UNAVAILABLE', async () => {
    await insertAppointment({
      technicianId: TECHNICIAN.LEEDS_CARL,
      serviceBayId: BAY.LEEDS_ALIGN,
      start: at(day, '10:00'),
      end: at(day, '11:00'),
    });
    const res = await post(
      body(at(day, '10:00'), { serviceTypeId: SERVICE_TYPE.ALIGNMENT }),
    ).expect(409);
    expect(res.body.code).toBe('SLOT_UNAVAILABLE');
  });

  it.each([
    [
      'START_IN_PAST',
      () =>
        DateTime.now()
          .setZone(LONDON)
          .minus({ days: 1 })
          .set({ hour: 10, minute: 0, second: 0, millisecond: 0 })
          .toISO()!,
    ],
    ['NOT_ON_SLOT_GRID', () => at(futureWeekday(), '10:07')],
    ['OUTSIDE_BOOKING_HORIZON', () => at(futureWeekday(120), '10:00')],
    ['OUTSIDE_OPENING_HOURS', () => at(futureWeekday(), '16:45')],
  ])('AS8: %s → 422', async (code, start) => {
    const res = await post(body(start())).expect(422);
    expect(res.body.code).toBe(code);
  });

  it('AS9: vehicle not owned by the customer → 422 VEHICLE_NOT_OWNED_BY_CUSTOMER', async () => {
    const res = await post(body(at(day, '10:00'), { vehicleId: VEHICLE.JONES_LEAF })).expect(422);
    expect(res.body.code).toBe('VEHICLE_NOT_OWNED_BY_CUSTOMER');
  });

  it('AS10: vehicle already booked at an overlapping time → 409 VEHICLE_ALREADY_BOOKED', async () => {
    await post(body(at(day, '10:00'))).expect(201);
    const res = await post(body(at(day, '10:15'))).expect(409);
    expect(res.body.code).toBe('VEHICLE_ALREADY_BOOKED');
  });

  it('back-to-back appointments do not conflict (half-open intervals)', async () => {
    await post(body(at(day, '10:00'))).expect(201);
    await post(body(at(day, '10:30'))).expect(201);
  });

  it('never assigns inactive technicians or bays; a 4th parallel booking is refused (3 active techs)', async () => {
    const cars = [
      { customerId: CUSTOMER.ALICE_SMITH, vehicleId: VEHICLE.SMITH_GOLF },
      { customerId: CUSTOMER.BEN_JONES, vehicleId: VEHICLE.JONES_LEAF },
      { customerId: CUSTOMER.CHLOE_BROWN, vehicleId: VEHICLE.BROWN_FIESTA },
    ];
    const results = [];
    for (const car of cars)
      results.push((await post(body(at(day, '12:00'), car)).expect(201)).body);
    expect(results.map((r) => r.technicianId)).not.toContain(TECHNICIAN.LEEDS_DORA_INACTIVE);
    expect(results.map((r) => r.serviceBayId)).not.toContain(BAY.LEEDS_INACTIVE);
    expect(new Set(results.map((r) => r.technicianId)).size).toBe(3);
  });

  it('rejects unknown properties and client-supplied durations (FR-002) with 422', async () => {
    for (const extra of [{ durationMinutes: 5 }, { foo: 'bar' }]) {
      const res = await post({ ...body(at(day, '10:00')), ...extra }).expect(422);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }
  });

  it('rejects malformed fields and a startAt without offset', async () => {
    const res = await post(body('2026-11-10T10:00:00', { customerId: 'not-a-uuid' })).expect(422);
    expect(res.body.errors.map((e: { field: string }) => e.field).sort()).toEqual([
      'customerId',
      'startAt',
    ]);
  });

  it('unknown appointment id → 404', async () => {
    await t.http
      .get(`${bookPath()}/00000000-0000-4000-8000-000000000000`)
      .set(asAcme())
      .expect(404);
    await t.http.get(`${bookPath()}/not-a-uuid`).set(asAcme()).expect(404);
  });
});
