import { DateTime } from 'luxon';
import { CancelAppointment } from '../../../src/application/use-cases/cancel-appointment';
import { SiteContext } from '../../../src/application/tenant-context';
import { Appointment } from '../../../src/domain/model/appointment';
import {
  BAY,
  DEALERSHIP,
  TECHNICIAN,
  TENANT,
} from '../../../src/infrastructure/persistence/seed/fixtures';
import { FakeClock } from './fakes/fake-clock';
import { RecordingTelemetry } from './fakes/recording-telemetry';
import { ScriptedUnitOfWork } from './fakes/scripted-unit-of-work';
import { SequentialIdGenerator } from './fakes/sequential-id-generator';

const ctx: SiteContext = {
  tenantId: TENANT.ACME,
  dealershipId: DEALERSHIP.LEEDS,
  userId: 'advisor-2',
};
const existing: Appointment = {
  id: 'appt-1',
  tenantId: TENANT.ACME,
  dealershipId: DEALERSHIP.LEEDS,
  customerId: 'c',
  vehicleId: 'v',
  serviceTypeId: 's',
  technicianId: TECHNICIAN.LEEDS_BELLA,
  serviceBayId: BAY.LEEDS_LIFT,
  startAt: DateTime.fromISO('2026-11-10T10:00:00Z'),
  endAt: DateTime.fromISO('2026-11-10T10:30:00Z'),
  status: 'CONFIRMED',
  assignmentMode: 'AUTO',
  channel: 'ADVISOR',
  createdBy: 'advisor-1',
  idempotencyKey: 'k',
  requestHash: 'h',
  version: 1,
  createdAt: DateTime.fromISO('2026-11-09T09:00:00Z'),
  updatedAt: DateTime.fromISO('2026-11-09T09:00:00Z'),
};

function setup(kind?: 'not_found' | 'not_confirmed' | 'stale') {
  const uow = new ScriptedUnitOfWork(() => ({ technicians: [], bays: [] }));
  uow.appointments.push(existing);
  if (kind) uow.updateScript = [kind];
  const telemetry = new RecordingTelemetry();
  return {
    uow,
    telemetry,
    useCase: new CancelAppointment(uow, new FakeClock(), new SequentialIdGenerator(), telemetry),
  };
}

describe('CancelAppointment (orchestration)', () => {
  it('cancels, bumps the version and appends a CANCELLED event in the same unit of work', async () => {
    const { useCase, uow, telemetry } = setup();
    const out = await useCase.execute(ctx, 'appt-1', 1);
    expect(out).toMatchObject({ status: 'CANCELLED', version: 2 });
    expect(uow.runs).toBe(1);
    expect(uow.events).toEqual([
      expect.objectContaining({
        type: 'CANCELLED',
        actor: 'advisor-2',
        appointmentId: 'appt-1',
        payload: {
          previousStatus: 'CONFIRMED',
          technicianId: TECHNICIAN.LEEDS_BELLA,
          serviceBayId: BAY.LEEDS_LIFT,
        },
      }),
    ]);
    expect(telemetry.counted('cancellations_total')).toEqual([{ outcome: 'cancelled' }]);
  });

  it.each([
    ['not_found', 'NOT_FOUND'],
    ['not_confirmed', 'NOT_CONFIRMED'],
    ['stale', 'STALE_VERSION'],
  ] as const)('%s → %s, and no event', async (kind, code) => {
    const { useCase, uow } = setup(kind);
    await expect(useCase.execute(ctx, 'appt-1', 1)).rejects.toMatchObject({ code });
    expect(uow.events).toHaveLength(0);
  });
});
