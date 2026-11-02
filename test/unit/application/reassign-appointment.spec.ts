import { DateTime } from 'luxon';
import { ReassignAppointment } from '../../../src/application/use-cases/reassign-appointment';
import { SiteContext } from '../../../src/application/tenant-context';
import { Appointment } from '../../../src/domain/model/appointment';
import {
  BAY,
  DEALERSHIP,
  SERVICE_TYPE,
  TECHNICIAN,
  TENANT,
} from '../../../src/infrastructure/persistence/seed/fixtures';
import { FakeClock } from './fakes/fake-clock';
import { InMemoryReference } from './fakes/in-memory-reference';
import { RecordingTelemetry } from './fakes/recording-telemetry';
import { ScriptedUnitOfWork } from './fakes/scripted-unit-of-work';
import { SequentialIdGenerator } from './fakes/sequential-id-generator';

const ctx: SiteContext = {
  tenantId: TENANT.ACME,
  dealershipId: DEALERSHIP.LEEDS,
  userId: 'advisor-3',
};
const appt = (over: Partial<Appointment> = {}): Appointment => ({
  id: 'a1',
  tenantId: TENANT.ACME,
  dealershipId: DEALERSHIP.LEEDS,
  customerId: 'c',
  vehicleId: 'v',
  serviceTypeId: SERVICE_TYPE.EV_CHECK,
  technicianId: TECHNICIAN.LEEDS_ALEX,
  serviceBayId: BAY.LEEDS_EV,
  startAt: DateTime.fromISO('2026-11-10T10:00:00Z'),
  endAt: DateTime.fromISO('2026-11-10T11:30:00Z'),
  status: 'CONFIRMED',
  assignmentMode: 'AUTO',
  channel: 'ADVISOR',
  createdBy: 'x',
  idempotencyKey: 'k',
  requestHash: 'h',
  version: 1,
  createdAt: DateTime.fromISO('2026-11-09T09:00:00Z'),
  updatedAt: DateTime.fromISO('2026-11-09T09:00:00Z'),
  ...over,
});

function setup(existing: Appointment = appt()) {
  const uow = new ScriptedUnitOfWork(() => ({ technicians: [], bays: [] }));
  uow.appointments.push(existing);
  const telemetry = new RecordingTelemetry();
  const repo = {
    findById: async (_c: SiteContext, id: string) =>
      uow.appointments.find((a) => a.id === id) ?? null,
  } as never;
  const useCase = new ReassignAppointment(
    repo,
    new InMemoryReference(),
    uow.resources,
    uow,
    new FakeClock(),
    new SequentialIdGenerator(),
    telemetry,
  );
  return { uow, telemetry, useCase };
}

describe('ReassignAppointment (orchestration)', () => {
  it('reassigns the bay, keeps the technician, marks MANUAL, records before/after', async () => {
    const existing = appt({ serviceTypeId: SERVICE_TYPE.OIL, serviceBayId: BAY.LEEDS_EV });
    const { useCase, uow, telemetry } = setup(existing);
    const out = await useCase.execute(ctx, 'a1', { version: 1, serviceBayId: BAY.LEEDS_LIFT });
    expect(out).toMatchObject({
      technicianId: TECHNICIAN.LEEDS_ALEX,
      serviceBayId: BAY.LEEDS_LIFT,
      assignmentMode: 'MANUAL',
      version: 2,
    });
    expect(uow.events[0]).toMatchObject({
      type: 'REASSIGNED',
      actor: 'advisor-3',
      payload: {
        before: { technicianId: TECHNICIAN.LEEDS_ALEX, serviceBayId: BAY.LEEDS_EV },
        after: { technicianId: TECHNICIAN.LEEDS_ALEX, serviceBayId: BAY.LEEDS_LIFT },
      },
    });
    expect(telemetry.counted('reassignments_total')).toEqual([{ outcome: 'reassigned' }]);
  });

  it.each([
    [
      'technician without the skill',
      { technicianId: TECHNICIAN.LEEDS_BELLA },
      'TECHNICIAN_NOT_QUALIFIED',
    ],
    ['inactive technician', { technicianId: TECHNICIAN.LEEDS_DORA_INACTIVE }, 'RESOURCE_INACTIVE'],
    [
      'technician from another site',
      { technicianId: TECHNICIAN.YORK_FAY },
      'RESOURCE_NOT_IN_DEALERSHIP',
    ],
    ['technician from another tenant', { technicianId: TECHNICIAN.BETA_GUS }, 'NOT_FOUND'],
    ['bay without the equipment', { serviceBayId: BAY.LEEDS_LIFT }, 'BAY_NOT_COMPATIBLE'],
    ['inactive bay', { serviceBayId: BAY.LEEDS_INACTIVE }, 'RESOURCE_INACTIVE'],
    ['bay from another site', { serviceBayId: BAY.YORK_2 }, 'RESOURCE_NOT_IN_DEALERSHIP'],
  ])('%s → %s (no write)', async (_l, over, code) => {
    const { useCase, uow } = setup();
    await expect(useCase.execute(ctx, 'a1', { version: 1, ...over })).rejects.toMatchObject({
      code,
    });
    expect(uow.runs).toBe(0);
  });

  it('an overlap on the chosen resource → RESOURCE_UNAVAILABLE (never substituted)', async () => {
    const { useCase, uow } = setup(appt({ serviceTypeId: SERVICE_TYPE.OIL }));
    uow.updateScript = ['conflict'];
    await expect(
      useCase.execute(ctx, 'a1', { version: 1, technicianId: TECHNICIAN.LEEDS_BELLA }),
    ).rejects.toMatchObject({
      code: 'RESOURCE_UNAVAILABLE',
    });
    expect(uow.events).toHaveLength(0);
  });

  it('stale version / not confirmed / missing are reported precisely', async () => {
    await expect(
      setup().useCase.execute(ctx, 'a1', { version: 7, technicianId: TECHNICIAN.LEEDS_ALEX }),
    ).rejects.toMatchObject({ code: 'STALE_VERSION' });
    await expect(
      setup(appt({ status: 'CANCELLED' })).useCase.execute(ctx, 'a1', {
        version: 1,
        technicianId: TECHNICIAN.LEEDS_ALEX,
      }),
    ).rejects.toMatchObject({ code: 'NOT_CONFIRMED' });
    await expect(
      setup().useCase.execute(ctx, 'nope', { version: 1, technicianId: TECHNICIAN.LEEDS_ALEX }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
