import { DomainError } from '../../domain/errors';
import { Appointment } from '../../domain/model/appointment';
import { UpdateOutcome } from '../ports/appointment.repository';
import { Clock } from '../ports/clock';
import { IdGenerator } from '../ports/id-generator';
import { Telemetry } from '../ports/telemetry';
import { UnitOfWork } from '../ports/unit-of-work';
import { SiteContext } from '../tenant-context';

/** Maps version-checked update outcomes to domain errors (FR-019). */
export function throwForUpdate(outcome: Exclude<UpdateOutcome, { kind: 'updated' }>): never {
  switch (outcome.kind) {
    case 'not_found':
      throw new DomainError('NOT_FOUND', 'Appointment not found');
    case 'not_confirmed':
      throw new DomainError('NOT_CONFIRMED', 'Only confirmed appointments can be changed');
    case 'stale':
      throw new DomainError(
        'STALE_VERSION',
        'The appointment was changed by someone else; refresh and retry',
      );
    case 'conflict':
      throw new DomainError('RESOURCE_UNAVAILABLE', 'Requested resource is busy at that time');
  }
}

/** FR-018: cancel a confirmed appointment; the partial exclusion constraints free capacity at once. */
export class CancelAppointment {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly telemetry: Telemetry,
  ) {}

  async execute(
    ctx: SiteContext,
    appointmentId: string,
    expectedVersion: number,
  ): Promise<Appointment> {
    const now = this.clock.now();
    const outcome = await this.uow.run(async (tx) => {
      const result = await tx.appointments.updateIfVersion(
        ctx,
        appointmentId,
        expectedVersion,
        { status: 'CANCELLED' },
        now,
      );
      if (result.kind === 'updated') {
        await tx.events.append(ctx, {
          id: this.ids.next(),
          tenantId: ctx.tenantId,
          appointmentId,
          type: 'CANCELLED',
          actor: ctx.userId,
          occurredAt: now,
          payload: {
            previousStatus: 'CONFIRMED',
            technicianId: result.appointment.technicianId,
            serviceBayId: result.appointment.serviceBayId,
          },
        });
      }
      return result;
    });
    if (outcome.kind !== 'updated') {
      this.telemetry.count('cancellations_total', { outcome: outcome.kind });
      throwForUpdate(outcome);
    }
    this.telemetry.count('cancellations_total', { outcome: 'cancelled' });
    this.telemetry.log('info', 'appointment.cancelled', {
      appointment_id: appointmentId,
      outcome: 'cancelled',
    });
    return outcome.appointment;
  }
}
