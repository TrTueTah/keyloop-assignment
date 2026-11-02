import {
  BookAppointment,
  BookAppointmentCommand,
} from '../../../src/application/use-cases/book-appointment';
import { SiteContext } from '../../../src/application/tenant-context';
import { LeastLoadedPolicy, ResourceCandidate } from '../../../src/domain/allocation-policy';
import { DomainError } from '../../../src/domain/errors';
import {
  BAY,
  CUSTOMER,
  DEALERSHIP,
  SERVICE_TYPE,
  TECHNICIAN,
  TENANT,
  VEHICLE,
} from '../../../src/infrastructure/persistence/seed/fixtures';
import { FakeClock } from './fakes/fake-clock';
import { InMemoryReference } from './fakes/in-memory-reference';
import { RecordingTelemetry } from './fakes/recording-telemetry';
import { ScriptedUnitOfWork } from './fakes/scripted-unit-of-work';
import { SequentialIdGenerator } from './fakes/sequential-id-generator';

const ctx: SiteContext = {
  tenantId: TENANT.ACME,
  dealershipId: DEALERSHIP.LEEDS,
  userId: 'advisor-1',
};
const cand = (id: string, bookedMinutes = 0, capabilityCount = 1): ResourceCandidate => ({
  id,
  bookedMinutes,
  capabilityCount,
});
const cmd = (over: Partial<BookAppointmentCommand> = {}): BookAppointmentCommand => ({
  idempotencyKey: 'key-1',
  customerId: CUSTOMER.ALICE_SMITH,
  vehicleId: VEHICLE.SMITH_GOLF,
  serviceTypeId: SERVICE_TYPE.OIL,
  startAt: '2026-11-10T10:00:00Z', // Tuesday, clock is Monday 09:00Z
  ...over,
});

function setup(script: ConstructorParameters<typeof ScriptedUnitOfWork>[1] = []) {
  const uow = new ScriptedUnitOfWork(
    (q) => ({
      technicians: [
        cand(TECHNICIAN.LEEDS_ALEX, 120),
        cand(TECHNICIAN.LEEDS_BELLA, 30),
        cand(TECHNICIAN.LEEDS_CARL, 60),
      ].filter(
        (t) =>
          !q.excludeTechnicianIds.includes(t.id) &&
          (!q.pinnedTechnicianId || q.pinnedTechnicianId === t.id),
      ),
      bays: [cand(BAY.LEEDS_EV, 0, 2), cand(BAY.LEEDS_LIFT, 0, 1)].filter(
        (b) => !q.excludeBayIds.includes(b.id) && (!q.pinnedBayId || q.pinnedBayId === b.id),
      ),
    }),
    script,
  );
  const telemetry = new RecordingTelemetry();
  const useCase = new BookAppointment(
    uow,
    uow,
    new InMemoryReference(),
    uow.resources,
    new LeastLoadedPolicy(),
    new FakeClock(),
    new SequentialIdGenerator(),
    telemetry,
  );
  return { uow, telemetry, useCase };
}

describe('BookAppointment (orchestration, in-memory ports)', () => {
  it('books the least-loaded technician and least-loaded/least-specialised bay', async () => {
    const { useCase, uow } = setup();
    const { appointment, replayed } = await useCase.execute(ctx, cmd());
    expect(replayed).toBe(false);
    expect(appointment).toMatchObject({
      technicianId: TECHNICIAN.LEEDS_BELLA,
      serviceBayId: BAY.LEEDS_LIFT,
      status: 'CONFIRMED',
      assignmentMode: 'AUTO',
      channel: 'ADVISOR',
      createdBy: 'advisor-1',
      version: 1,
    });
    expect(appointment.endAt.diff(appointment.startAt, 'minutes').minutes).toBe(30); // duration from service type
    expect(uow.events).toHaveLength(1);
    expect(uow.events[0]).toMatchObject({
      type: 'CREATED',
      actor: 'advisor-1',
      appointmentId: appointment.id,
    });
  });

  it('CREATED event payload carries only ids/enums/timestamps (FR-027)', async () => {
    const { useCase, uow } = setup();
    await useCase.execute(ctx, cmd());
    expect(Object.keys(uow.events[0].payload).sort()).toEqual(
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
  });

  it('retries in a NEW transaction excluding the technician that lost the race', async () => {
    const { useCase, uow, telemetry } = setup(['technician', 'ok']);
    const { appointment } = await useCase.execute(ctx, cmd());
    expect(uow.runs).toBe(2);
    expect(uow.candidateQueries[1].excludeTechnicianIds).toEqual([TECHNICIAN.LEEDS_BELLA]);
    expect(appointment.technicianId).toBe(TECHNICIAN.LEEDS_CARL);
    expect(telemetry.counted('booking_conflicts_total')).toEqual([{ constraint: 'technician' }]);
    expect(telemetry.counted('booking_retry_attempts_total')).toHaveLength(1);
  });

  it('retries a transient (deadlock) abort with the SAME candidates', async () => {
    const { useCase, uow } = setup(['transient', 'ok']);
    const { appointment } = await useCase.execute(ctx, cmd());
    expect(uow.runs).toBe(2);
    expect(uow.candidateQueries[1].excludeTechnicianIds).toEqual([]);
    expect(uow.candidateQueries[1].excludeBayIds).toEqual([]);
    expect(appointment.technicianId).toBe(TECHNICIAN.LEEDS_BELLA);
  });

  it('gives up after 3 attempts with SLOT_UNAVAILABLE', async () => {
    const { useCase, uow } = setup(['bay', 'bay', 'technician']);
    await expect(useCase.execute(ctx, cmd())).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });
    expect(uow.runs).toBe(3);
    expect(uow.appointments).toHaveLength(0);
    expect(uow.events).toHaveLength(0);
  });

  it('a vehicle conflict is terminal: VEHICLE_ALREADY_BOOKED, no retry', async () => {
    const { useCase, uow } = setup(['vehicle']);
    await expect(useCase.execute(ctx, cmd())).rejects.toMatchObject({
      code: 'VEHICLE_ALREADY_BOOKED',
    });
    expect(uow.runs).toBe(1);
  });

  it('attaches alternatives from the finder to SLOT_UNAVAILABLE (US2, FR-012)', async () => {
    const { uow, telemetry } = setup();
    uow.candidates = () => ({ technicians: [], bays: [] });
    const alternatives = [{ startAt: 'a', endAt: 'b', availableTechnicians: 1, availableBays: 2 }];
    const finder = jest.fn().mockResolvedValue(alternatives);
    const useCase = new BookAppointment(
      uow,
      uow,
      new InMemoryReference(),
      uow.resources,
      new LeastLoadedPolicy(),
      new FakeClock(),
      new SequentialIdGenerator(),
      telemetry,
      finder,
    );
    await expect(useCase.execute(ctx, cmd())).rejects.toMatchObject({
      code: 'SLOT_UNAVAILABLE',
      meta: { alternatives },
    });
    expect(finder).toHaveBeenCalledTimes(1);
  });

  it('SLOT_UNAVAILABLE when no qualified technician or compatible bay is free', async () => {
    const { useCase, uow } = setup();
    uow.candidates = () => ({ technicians: [], bays: [cand(BAY.LEEDS_LIFT)] });
    await expect(useCase.execute(ctx, cmd())).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });
  });

  describe('manual pins (US4, FR-014/016)', () => {
    it('uses the pinned technician as-is, still auto-ranks the bay, marks MANUAL', async () => {
      const { useCase, uow } = setup();
      const { appointment } = await useCase.execute(
        ctx,
        cmd({ technicianId: TECHNICIAN.LEEDS_ALEX }),
      );
      expect(appointment).toMatchObject({
        technicianId: TECHNICIAN.LEEDS_ALEX,
        serviceBayId: BAY.LEEDS_LIFT,
        assignmentMode: 'MANUAL',
      });
      expect(uow.candidateQueries[0].pinnedTechnicianId).toBe(TECHNICIAN.LEEDS_ALEX);
    });

    it('a busy pinned technician → RESOURCE_UNAVAILABLE immediately, nobody else is substituted', async () => {
      const { useCase, uow } = setup();
      uow.candidates = () => ({ technicians: [], bays: [cand(BAY.LEEDS_LIFT)] });
      await expect(
        useCase.execute(ctx, cmd({ technicianId: TECHNICIAN.LEEDS_ALEX })),
      ).rejects.toMatchObject({ code: 'RESOURCE_UNAVAILABLE' });
      expect(uow.runs).toBe(1);
    });

    it('a pinned technician losing the race → RESOURCE_UNAVAILABLE, no retry', async () => {
      const { useCase, uow } = setup(['technician']);
      await expect(
        useCase.execute(ctx, cmd({ technicianId: TECHNICIAN.LEEDS_ALEX })),
      ).rejects.toMatchObject({ code: 'RESOURCE_UNAVAILABLE' });
      expect(uow.runs).toBe(1);
    });

    it('a pinned bay losing the race → RESOURCE_UNAVAILABLE; an unpinned technician conflict still retries', async () => {
      const pinnedBay = setup(['bay']);
      await expect(
        pinnedBay.useCase.execute(ctx, cmd({ serviceBayId: BAY.LEEDS_LIFT })),
      ).rejects.toMatchObject({ code: 'RESOURCE_UNAVAILABLE' });
      const retry = setup(['technician', 'ok']);
      await expect(
        retry.useCase.execute(ctx, cmd({ serviceBayId: BAY.LEEDS_LIFT })),
      ).resolves.toMatchObject({
        appointment: { serviceBayId: BAY.LEEDS_LIFT, technicianId: TECHNICIAN.LEEDS_CARL },
      });
    });

    it.each([
      [
        'wrong skill',
        { serviceTypeId: SERVICE_TYPE.EV_CHECK, technicianId: TECHNICIAN.LEEDS_BELLA },
        'TECHNICIAN_NOT_QUALIFIED',
      ],
      ['inactive', { technicianId: TECHNICIAN.LEEDS_DORA_INACTIVE }, 'RESOURCE_INACTIVE'],
      ['another dealership', { technicianId: TECHNICIAN.YORK_ELI }, 'RESOURCE_NOT_IN_DEALERSHIP'],
      ['another tenant', { technicianId: TECHNICIAN.BETA_GUS }, 'NOT_FOUND'],
      [
        'bay lacking equipment',
        { serviceTypeId: SERVICE_TYPE.ALIGNMENT, serviceBayId: BAY.LEEDS_LIFT },
        'BAY_NOT_COMPATIBLE',
      ],
    ])('pin %s → %s before any write', async (_l, over, code) => {
      const { useCase, uow } = setup();
      await expect(useCase.execute(ctx, cmd(over))).rejects.toMatchObject({ code });
      expect(uow.runs).toBe(0);
    });
  });

  describe('idempotency (FR-010)', () => {
    it('same key + same request → returns the original, inserts nothing', async () => {
      const { useCase, uow } = setup();
      const first = await useCase.execute(ctx, cmd());
      const again = await useCase.execute(ctx, cmd());
      expect(again).toEqual({ appointment: first.appointment, replayed: true });
      expect(uow.appointments).toHaveLength(1);
      expect(uow.runs).toBe(1);
    });

    it('same key + a different request → IDEMPOTENCY_KEY_REUSED', async () => {
      const { useCase } = setup();
      await useCase.execute(ctx, cmd());
      await expect(
        useCase.execute(ctx, cmd({ startAt: '2026-11-10T11:00:00Z' })),
      ).rejects.toMatchObject({
        code: 'IDEMPOTENCY_KEY_REUSED',
      });
    });

    it('treats the same instant written with a different offset as the same request', async () => {
      const { useCase } = setup();
      await useCase.execute(ctx, cmd());
      await expect(
        useCase.execute(ctx, cmd({ startAt: '2026-11-10T11:00:00+01:00' })),
      ).resolves.toMatchObject({
        replayed: true,
      });
    });

    it('a concurrent winner with the same key (unique-index race) → re-read and replay', async () => {
      const { useCase, uow } = setup(['idempotency_key']);
      const winner = await setup().useCase.execute(ctx, cmd()); // computed with identical inputs/ids
      uow.onIdempotencyConflict = () => uow.appointments.push(winner.appointment);
      await expect(useCase.execute(ctx, cmd())).resolves.toMatchObject({ replayed: true });
    });

    it('a racing duplicate that surfaces as a vehicle conflict is still a replay, not a 409', async () => {
      const { useCase, uow } = setup(['vehicle']);
      const winner = await setup().useCase.execute(ctx, cmd());
      uow.onIdempotencyConflict = undefined;
      const originalInsert = uow.insertScript;
      expect(originalInsert).toEqual(['vehicle']);
      // Simulate the winner committing while our insert was blocked on the exclusion constraint.
      const run = uow.run.bind(uow);
      uow.run = async (work) => {
        const r = await run(work);
        if (!uow.appointments.includes(winner.appointment))
          uow.appointments.push(winner.appointment);
        return r;
      };
      await expect(useCase.execute(ctx, cmd())).resolves.toMatchObject({ replayed: true });
    });
  });

  describe('request validation (before any write)', () => {
    it.each([
      ['unknown service type', { serviceTypeId: SERVICE_TYPE.BETA_OIL }, 'NOT_FOUND'],
      ['another tenant’s vehicle', { vehicleId: VEHICLE.BETA_CIVIC }, 'NOT_FOUND'],
      [
        'vehicle not owned by customer',
        { vehicleId: VEHICLE.JONES_LEAF },
        'VEHICLE_NOT_OWNED_BY_CUSTOMER',
      ],
      ['start in the past', { startAt: '2026-11-09T08:00:00Z' }, 'START_IN_PAST'],
      ['off the slot grid', { startAt: '2026-11-10T10:05:00Z' }, 'NOT_ON_SLOT_GRID'],
      ['outside opening hours', { startAt: '2026-11-10T16:45:00Z' }, 'OUTSIDE_OPENING_HOURS'],
      ['unparseable start', { startAt: 'tomorrow' }, 'VALIDATION_FAILED'],
    ])('%s → %s', async (_l, over, code) => {
      const { useCase, uow } = setup();
      await expect(useCase.execute(ctx, cmd(over))).rejects.toMatchObject({ code });
      expect(uow.runs).toBe(0);
    });
  });

  it('records outcome metrics without tenant labels and wraps allocation in a span', async () => {
    const { useCase, telemetry } = setup();
    await useCase.execute(ctx, cmd());
    expect(telemetry.counted('bookings_total')).toEqual([
      { outcome: 'confirmed', assignment_mode: 'AUTO', channel: 'ADVISOR' },
    ]);
    expect(telemetry.spans).toEqual(expect.arrayContaining(['booking', 'allocate']));
    for (const c of telemetry.counts) expect(Object.keys(c.attributes)).not.toContain('tenant_id');
  });

  it('records a failed booking outcome', async () => {
    const { useCase, telemetry } = setup(['vehicle']);
    await expect(useCase.execute(ctx, cmd())).rejects.toBeInstanceOf(DomainError);
    expect(telemetry.counted('bookings_total')).toEqual([
      {
        outcome: 'rejected',
        code: 'VEHICLE_ALREADY_BOOKED',
        assignment_mode: 'AUTO',
        channel: 'ADVISOR',
      },
    ]);
  });
});
