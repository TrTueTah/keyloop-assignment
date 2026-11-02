import {
  BAY,
  DEALERSHIP,
  SERVICE_TYPE,
  TECHNICIAN,
  VEHICLE,
  CUSTOMER,
} from '../../src/infrastructure/persistence/seed/fixtures';
import { asAcme, createTestApp, TestApp } from '../setup/app';
import { sql, truncateTransactional } from '../setup/db';
import { at, body, bookPath, futureWeekday, insertAppointment } from '../setup/scheduling';

describe('US4: manually choose or change the technician or bay (FR-014..017, FR-022)', () => {
  let t: TestApp;
  const day = futureWeekday(10);
  let key = 0;
  const post = (b: object) =>
    t.http.post(bookPath()).set(asAcme()).set('Idempotency-Key', `asg-${++key}`).send(b);
  const reassign = (id: string, b: object) =>
    t.http.patch(`${bookPath()}/${id}/assignment`).set(asAcme('advisor-9')).send(b);

  beforeAll(async () => {
    t = await createTestApp({ logLevel: 'warn' });
  });
  afterAll(() => t.close());
  beforeEach(truncateTransactional);

  it('AS1: a pinned free, qualified technician is assigned; the bay is auto-assigned; mode MANUAL', async () => {
    const res = await post(body(at(day, '10:00'), { technicianId: TECHNICIAN.LEEDS_ALEX })).expect(
      201,
    );
    expect(res.body).toMatchObject({
      technicianId: TECHNICIAN.LEEDS_ALEX,
      serviceBayId: BAY.LEEDS_LIFT,
      assignmentMode: 'MANUAL',
    });
  });

  it('AS2: a pinned busy technician → 409 RESOURCE_UNAVAILABLE; nobody is silently substituted', async () => {
    await insertAppointment({
      technicianId: TECHNICIAN.LEEDS_ALEX,
      serviceBayId: BAY.LEEDS_EV,
      start: at(day, '10:00'),
      end: at(day, '11:00'),
    });
    const res = await post(body(at(day, '10:00'), { technicianId: TECHNICIAN.LEEDS_ALEX })).expect(
      409,
    );
    expect(res.body.code).toBe('RESOURCE_UNAVAILABLE');
    expect(await sql(`SELECT 1 FROM appointment WHERE created_by = 'advisor-1'`)).toHaveLength(0);
  });

  it('AS3: reassign to a free, qualified technician → updated, MANUAL, version +1, REASSIGNED event with before/after', async () => {
    const booked = (await post(body(at(day, '10:00'))).expect(201)).body;
    const target = [TECHNICIAN.LEEDS_ALEX, TECHNICIAN.LEEDS_BELLA, TECHNICIAN.LEEDS_CARL].find(
      (x) => x !== booked.technicianId,
    )!;
    const res = await reassign(booked.id, { technicianId: target, version: 1 }).expect(200);
    expect(res.body).toMatchObject({
      technicianId: target,
      serviceBayId: booked.serviceBayId,
      assignmentMode: 'MANUAL',
      version: 2,
    });
    const [event] = await sql<{ type: string; actor: string; payload: Record<string, unknown> }>(
      `SELECT type, actor, payload FROM appointment_event WHERE appointment_id = $1 AND type = 'REASSIGNED'`,
      [booked.id],
    );
    expect(event).toEqual({
      type: 'REASSIGNED',
      actor: 'advisor-9',
      payload: {
        before: { technicianId: booked.technicianId, serviceBayId: booked.serviceBayId },
        after: { technicianId: target, serviceBayId: booked.serviceBayId },
      },
    });
  });

  it('AS4: unqualified technician / incompatible bay / inactive → 422 with the specific code', async () => {
    const ev = (
      await post(body(at(day, '10:00'), { serviceTypeId: SERVICE_TYPE.EV_CHECK })).expect(201)
    ).body;
    expect(
      (await reassign(ev.id, { technicianId: TECHNICIAN.LEEDS_BELLA, version: 1 }).expect(422)).body
        .code,
    ).toBe('TECHNICIAN_NOT_QUALIFIED');
    expect(
      (await reassign(ev.id, { serviceBayId: BAY.LEEDS_LIFT, version: 1 }).expect(422)).body.code,
    ).toBe('BAY_NOT_COMPATIBLE');
    expect(
      (await reassign(ev.id, { serviceBayId: BAY.LEEDS_INACTIVE, version: 1 }).expect(422)).body
        .code,
    ).toBe('RESOURCE_INACTIVE');
  });

  it('AS5: a technician or bay from another dealership → 422 RESOURCE_NOT_IN_DEALERSHIP', async () => {
    const booked = (await post(body(at(day, '10:00'))).expect(201)).body;
    expect(
      (await reassign(booked.id, { technicianId: TECHNICIAN.YORK_ELI, version: 1 }).expect(422))
        .body.code,
    ).toBe('RESOURCE_NOT_IN_DEALERSHIP');
    expect(
      (await post(body(at(day, '11:00'), { serviceBayId: BAY.YORK_1 })).expect(422)).body.code,
    ).toBe('RESOURCE_NOT_IN_DEALERSHIP');
  });

  it('reassigning onto a technician who is busy then → 409 RESOURCE_UNAVAILABLE (real exclusion constraint)', async () => {
    const booked = (await post(body(at(day, '10:00'))).expect(201)).body;
    const busyTech = [TECHNICIAN.LEEDS_ALEX, TECHNICIAN.LEEDS_BELLA, TECHNICIAN.LEEDS_CARL].find(
      (x) => x !== booked.technicianId,
    )!;
    await insertAppointment({
      technicianId: busyTech,
      serviceBayId: BAY.LEEDS_EV,
      start: at(day, '10:15'),
      end: at(day, '10:45'),
      vehicleId: VEHICLE.JONES_LEAF,
      customerId: CUSTOMER.BEN_JONES,
    });
    expect(
      (await reassign(booked.id, { technicianId: busyTech, version: 1 }).expect(409)).body.code,
    ).toBe('RESOURCE_UNAVAILABLE');
    const [row] = await sql<{ technician_id: string; version: number }>(
      `SELECT technician_id, version FROM appointment WHERE id = $1`,
      [booked.id],
    );
    expect(row).toEqual({ technician_id: booked.technicianId, version: 1 });
  });

  it('stale version → 409 STALE_VERSION; version-only body → 422', async () => {
    const booked = (await post(body(at(day, '10:00'))).expect(201)).body;
    await reassign(booked.id, { serviceBayId: BAY.LEEDS_ALIGN, version: 1 }).expect(200);
    expect(
      (await reassign(booked.id, { serviceBayId: BAY.LEEDS_EV, version: 1 }).expect(409)).body.code,
    ).toBe('STALE_VERSION');
    expect((await reassign(booked.id, { version: 2 }).expect(422)).body.code).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('cancelled appointments cannot be reassigned → 409 NOT_CONFIRMED', async () => {
    const booked = (await post(body(at(day, '10:00'))).expect(201)).body;
    await t.http
      .post(`${bookPath()}/${booked.id}/cancel`)
      .set(asAcme())
      .send({ version: 1 })
      .expect(200);
    expect(
      (await reassign(booked.id, { serviceBayId: BAY.LEEDS_ALIGN, version: 2 }).expect(409)).body
        .code,
    ).toBe('NOT_CONFIRMED');
  });

  it('uses the Race Bay site to prove pin + auto mix works for bays too', async () => {
    const res = await t.http
      .post(bookPath(DEALERSHIP.RACE))
      .set(asAcme())
      .set('Idempotency-Key', `asg-${++key}`)
      .send(body(at(day, '10:00'), { serviceBayId: BAY.RACE_1 }))
      .expect(201);
    expect(res.body).toMatchObject({
      serviceBayId: BAY.RACE_1,
      technicianId: TECHNICIAN.RACE_HAL,
      assignmentMode: 'MANUAL',
    });
  });
});
