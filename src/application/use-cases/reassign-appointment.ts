import { DomainError } from '../../domain/errors';
import { Appointment } from '../../domain/model/appointment';
import { checkPinnedBay, checkPinnedTechnician } from '../../domain/qualification';
import { AppointmentRepository } from '../ports/appointment.repository';
import { Clock } from '../ports/clock';
import { IdGenerator } from '../ports/id-generator';
import { ReferenceQuery } from '../ports/reference.query';
import { ResourceQuery } from '../ports/resource.query';
import { Telemetry } from '../ports/telemetry';
import { UnitOfWork } from '../ports/unit-of-work';
import { SiteContext } from '../tenant-context';
import { throwForUpdate } from './cancel-appointment';

export interface ReassignCommand {
  readonly version: number;
  readonly technicianId?: string;
  readonly serviceBayId?: string;
}

/**
 * FR-015..FR-017, FR-019: an advisor changes the technician and/or bay. Same checks as automatic
 * assignment; the exclusion constraints reject overlaps, and a busy choice is never substituted.
 */
export class ReassignAppointment {
  constructor(
    private readonly appointments: AppointmentRepository,
    private readonly reference: ReferenceQuery,
    private readonly resources: ResourceQuery,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly telemetry: Telemetry,
  ) {}

  async execute(
    ctx: SiteContext,
    appointmentId: string,
    cmd: ReassignCommand,
  ): Promise<Appointment> {
    try {
      const result = await this.reassign(ctx, appointmentId, cmd);
      this.telemetry.count('reassignments_total', { outcome: 'reassigned' });
      this.telemetry.log('info', 'appointment.reassigned', {
        appointment_id: appointmentId,
        outcome: 'reassigned',
      });
      return result;
    } catch (err) {
      if (err instanceof DomainError)
        this.telemetry.count('reassignments_total', { outcome: 'rejected', code: err.code });
      throw err;
    }
  }

  private async reassign(
    ctx: SiteContext,
    appointmentId: string,
    cmd: ReassignCommand,
  ): Promise<Appointment> {
    if (!cmd.technicianId && !cmd.serviceBayId) {
      throw new DomainError('VALIDATION_FAILED', 'Provide technicianId and/or serviceBayId');
    }
    const current = await this.appointments.findById(ctx, appointmentId);
    if (!current) throw new DomainError('NOT_FOUND', 'Appointment not found');
    if (current.status !== 'CONFIRMED') throw new DomainError('NOT_CONFIRMED');
    if (current.version !== cmd.version) throw new DomainError('STALE_VERSION');
    const serviceType = await this.reference.getServiceType(ctx, current.serviceTypeId);
    if (!serviceType) throw new DomainError('NOT_FOUND', 'Service type not found');

    if (cmd.technicianId) {
      const tech = await this.resources.getTechnician(ctx, cmd.technicianId);
      if (!tech) throw new DomainError('NOT_FOUND', 'Technician not found');
      const code = checkPinnedTechnician(tech, serviceType, ctx.dealershipId);
      if (code) throw new DomainError(code);
    }
    if (cmd.serviceBayId) {
      const bay = await this.resources.getBay(ctx, cmd.serviceBayId);
      if (!bay) throw new DomainError('NOT_FOUND', 'Service bay not found');
      const code = checkPinnedBay(bay, serviceType, ctx.dealershipId);
      if (code) throw new DomainError(code);
    }

    const after = {
      technicianId: cmd.technicianId ?? current.technicianId,
      serviceBayId: cmd.serviceBayId ?? current.serviceBayId,
    };
    const now = this.clock.now();
    const outcome = await this.uow.run(async (tx) => {
      const result = await tx.appointments.updateIfVersion(
        ctx,
        appointmentId,
        cmd.version,
        { ...after, assignmentMode: 'MANUAL' },
        now,
      );
      if (result.kind === 'updated') {
        await tx.events.append(ctx, {
          id: this.ids.next(),
          tenantId: ctx.tenantId,
          appointmentId,
          type: 'REASSIGNED',
          actor: ctx.userId,
          occurredAt: now,
          payload: {
            before: { technicianId: current.technicianId, serviceBayId: current.serviceBayId },
            after,
          },
        });
      }
      return result;
    });
    if (outcome.kind !== 'updated') throwForUpdate(outcome);
    return outcome.appointment;
  }
}
