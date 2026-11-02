import { createHash } from 'node:crypto';
import { AllocationPolicy } from '../../domain/allocation-policy';
import { validateRequestedSlot } from '../../domain/booking-rules';
import { DomainError, ErrorCode } from '../../domain/errors';
import { interval } from '../../domain/interval';
import { Appointment, AssignmentMode, BookingChannel } from '../../domain/model/appointment';
import { Dealership } from '../../domain/model/dealership';
import { ServiceType } from '../../domain/model/service-type';
import { checkPinnedBay, checkPinnedTechnician } from '../../domain/qualification';
import { DateTime, localDateOf, localDayBounds } from '../../domain/time';
import { ConflictTarget } from '../ports/appointment.repository';
import { Clock } from '../ports/clock';
import { IdGenerator } from '../ports/id-generator';
import { IdempotencyStore } from '../ports/idempotency.store';
import { ReferenceQuery } from '../ports/reference.query';
import { ResourceQuery } from '../ports/resource.query';
import { Telemetry } from '../ports/telemetry';
import { UnitOfWork } from '../ports/unit-of-work';
import { SiteContext } from '../tenant-context';

export const MAX_BOOKING_ATTEMPTS = 3;

export interface BookAppointmentCommand {
  readonly idempotencyKey: string;
  readonly customerId: string;
  readonly vehicleId: string;
  readonly serviceTypeId: string;
  /** ISO-8601 with offset. */
  readonly startAt: string;
  readonly channel?: BookingChannel;
  readonly technicianId?: string;
  readonly serviceBayId?: string;
}

export interface BookAppointmentResult {
  readonly appointment: Appointment;
  /** True when an identical earlier request with the same Idempotency-Key is being replayed. */
  readonly replayed: boolean;
}

/** Produces the alternatives attached to SLOT_UNAVAILABLE (wired by US2). */
export type AlternativesFinder = (
  ctx: SiteContext,
  serviceType: ServiceType,
  dealership: Dealership,
  requestedStart: DateTime,
) => Promise<NonNullable<DomainError['meta']['alternatives']>>;

type AttemptResult =
  | { kind: 'booked'; appointment: Appointment }
  | { kind: 'none' }
  | { kind: 'pinned_busy' }
  | { kind: 'conflict'; on: ConflictTarget; technicianId: string; bayId: string };

/**
 * FR-001..FR-010 + FR-014. Correctness under concurrency comes from the database (exclusion
 * constraints); this use case only decides what to do with each typed outcome (research R6/R8):
 * retry a lost race on an auto-assigned technician/bay (≤ 3 attempts, fresh transaction each),
 * fail fast on pinned resources and vehicle overlaps, and resolve idempotency races by re-reading.
 */
export class BookAppointment {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly idempotency: IdempotencyStore,
    private readonly reference: ReferenceQuery,
    private readonly resources: ResourceQuery,
    private readonly policy: AllocationPolicy,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly telemetry: Telemetry,
    private readonly alternatives?: AlternativesFinder,
  ) {}

  async execute(ctx: SiteContext, cmd: BookAppointmentCommand): Promise<BookAppointmentResult> {
    const channel: BookingChannel = cmd.channel ?? 'ADVISOR';
    const mode: AssignmentMode = cmd.technicianId || cmd.serviceBayId ? 'MANUAL' : 'AUTO';
    const metricBase = { assignment_mode: mode, channel };
    const startedAt = this.clock.now();
    const observeDuration = (outcome: string) =>
      this.telemetry.observe(
        'booking_duration_seconds',
        this.clock.now().diff(startedAt).as('seconds'),
        { outcome },
      );
    try {
      const result = await this.telemetry.span('booking', { channel, assignment_mode: mode }, () =>
        this.book(ctx, cmd, channel, mode),
      );
      this.telemetry.count('bookings_total', {
        outcome: result.replayed ? 'replayed' : 'confirmed',
        ...metricBase,
      });
      observeDuration(result.replayed ? 'replayed' : 'confirmed');
      this.telemetry.log('info', 'booking.completed', {
        outcome: result.replayed ? 'replayed' : 'confirmed',
        appointment_id: result.appointment.id,
      });
      return result;
    } catch (err) {
      if (err instanceof DomainError) {
        this.telemetry.count('bookings_total', {
          outcome: 'rejected',
          code: err.code,
          ...metricBase,
        });
        observeDuration('rejected');
        this.telemetry.log('info', 'booking.rejected', { outcome: 'rejected', code: err.code });
      }
      throw err;
    }
  }

  private async book(
    ctx: SiteContext,
    cmd: BookAppointmentCommand,
    channel: BookingChannel,
    mode: AssignmentMode,
  ): Promise<BookAppointmentResult> {
    const start = DateTime.fromISO(cmd.startAt, { setZone: true });
    if (!start.isValid) {
      throw new DomainError(
        'VALIDATION_FAILED',
        'startAt must be an ISO-8601 date-time with offset',
        {
          errors: [{ field: 'startAt', message: 'must be an ISO-8601 date-time with offset' }],
        },
      );
    }
    const requestHash = hashRequest(ctx, cmd, start, channel);

    const previous = await this.replayIfKnown(ctx, cmd.idempotencyKey, requestHash);
    if (previous) return previous;

    const serviceType = await this.reference.getServiceType(ctx, cmd.serviceTypeId);
    if (!serviceType) throw new DomainError('NOT_FOUND', 'Service type not found');
    const dealership = await this.reference.findDealershipInTenant(ctx.tenantId, ctx.dealershipId);
    if (!dealership) throw new DomainError('NOT_FOUND', 'Dealership not found');
    const cv = await this.reference.checkCustomerVehicle(ctx, cmd.customerId, cmd.vehicleId);
    if (!cv.customerExists || !cv.vehicleExists)
      throw new DomainError('NOT_FOUND', 'Customer or vehicle not found');
    if (!cv.ownedByCustomer) throw new DomainError('VEHICLE_NOT_OWNED_BY_CUSTOMER');

    const now = this.clock.now();
    const rule = validateRequestedSlot(now, start, serviceType.durationMinutes, dealership);
    if (rule) throw new DomainError(rule);
    await this.checkPins(ctx, cmd, serviceType);

    const slot = interval(
      start.toUTC(),
      start.plus({ minutes: serviceType.durationMinutes }).toUTC(),
    );
    const localDay = localDayBounds(localDateOf(start, dealership.timezone), dealership.timezone);
    const excludeTechnicianIds: string[] = [];
    const excludeBayIds: string[] = [];

    for (let attempt = 1; attempt <= MAX_BOOKING_ATTEMPTS; attempt++) {
      if (attempt > 1) this.telemetry.count('booking_retry_attempts_total', { attempt });
      const outcome: AttemptResult = await this.uow.run(async (tx) => {
        const candidates = await tx.resources.findCandidates(ctx, {
          serviceType,
          slot,
          localDay,
          excludeTechnicianIds,
          excludeBayIds,
          pinnedTechnicianId: cmd.technicianId,
          pinnedBayId: cmd.serviceBayId,
        });
        if (
          (cmd.technicianId && candidates.technicians.length === 0) ||
          (cmd.serviceBayId && candidates.bays.length === 0)
        ) {
          return { kind: 'pinned_busy' };
        }
        if (candidates.technicians.length === 0 || candidates.bays.length === 0)
          return { kind: 'none' };

        const [technician, bay] = await this.telemetry.span('allocate', { attempt }, () => [
          this.policy.rank(candidates.technicians)[0],
          this.policy.rank(candidates.bays)[0],
        ]);
        const appointment: Appointment = {
          id: this.ids.next(),
          tenantId: ctx.tenantId,
          dealershipId: ctx.dealershipId,
          customerId: cmd.customerId,
          vehicleId: cmd.vehicleId,
          serviceTypeId: serviceType.id,
          technicianId: technician.id,
          serviceBayId: bay.id,
          startAt: slot.start,
          endAt: slot.end,
          status: 'CONFIRMED',
          assignmentMode: mode,
          channel,
          createdBy: ctx.userId,
          idempotencyKey: cmd.idempotencyKey,
          requestHash,
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
        const inserted = await tx.appointments.insert(ctx, appointment);
        if (inserted.kind === 'conflict') {
          return { kind: 'conflict', on: inserted.on, technicianId: technician.id, bayId: bay.id };
        }
        await tx.events.append(ctx, {
          id: this.ids.next(),
          tenantId: ctx.tenantId,
          appointmentId: appointment.id,
          type: 'CREATED',
          actor: ctx.userId,
          occurredAt: now,
          payload: {
            serviceTypeId: appointment.serviceTypeId,
            vehicleId: appointment.vehicleId,
            technicianId: appointment.technicianId,
            serviceBayId: appointment.serviceBayId,
            startAt: appointment.startAt.toISO(),
            endAt: appointment.endAt.toISO(),
            assignmentMode: appointment.assignmentMode,
            channel: appointment.channel,
          },
        });
        return { kind: 'booked', appointment };
      });

      if (outcome.kind === 'booked') return { appointment: outcome.appointment, replayed: false };
      if (outcome.kind === 'pinned_busy')
        throw new DomainError('RESOURCE_UNAVAILABLE', 'Requested resource is busy');
      if (outcome.kind === 'none') break;

      this.telemetry.count('booking_conflicts_total', { constraint: outcome.on });
      this.telemetry.log('info', 'booking.conflict', { attempt, constraint: outcome.on });
      // A concurrent duplicate of THIS request may have won; it can surface as any constraint.
      const replay = await this.replayIfKnown(ctx, cmd.idempotencyKey, requestHash);
      if (replay) return replay;
      if (outcome.on === 'transient') continue; // deadlock/serialization abort: same candidates, new tx
      if (outcome.on === 'vehicle') throw new DomainError('VEHICLE_ALREADY_BOOKED');
      if (outcome.on === 'technician') {
        if (cmd.technicianId)
          throw new DomainError('RESOURCE_UNAVAILABLE', 'Requested technician is busy');
        excludeTechnicianIds.push(outcome.technicianId);
      }
      if (outcome.on === 'bay') {
        if (cmd.serviceBayId)
          throw new DomainError('RESOURCE_UNAVAILABLE', 'Requested service bay is busy');
        excludeBayIds.push(outcome.bayId);
      }
    }

    const alternatives = this.alternatives
      ? await this.alternatives(ctx, serviceType, dealership, start)
      : undefined;
    throw new DomainError(
      'SLOT_UNAVAILABLE',
      'No qualified technician and compatible bay are free for the whole duration',
      alternatives ? { alternatives } : {},
    );
  }

  private async replayIfKnown(
    ctx: SiteContext,
    key: string,
    requestHash: string,
  ): Promise<BookAppointmentResult | null> {
    const existing = await this.idempotency.findByKey(ctx, key);
    if (!existing) return null;
    if (existing.requestHash !== requestHash) throw new DomainError('IDEMPOTENCY_KEY_REUSED');
    return { appointment: existing, replayed: true };
  }

  private async checkPins(
    ctx: SiteContext,
    cmd: BookAppointmentCommand,
    serviceType: ServiceType,
  ): Promise<void> {
    const fail = (code: ErrorCode | null) => {
      if (code) throw new DomainError(code);
    };
    if (cmd.technicianId) {
      const tech = await this.resources.getTechnician(ctx, cmd.technicianId);
      if (!tech) throw new DomainError('NOT_FOUND', 'Technician not found');
      fail(checkPinnedTechnician(tech, serviceType, ctx.dealershipId));
    }
    if (cmd.serviceBayId) {
      const bay = await this.resources.getBay(ctx, cmd.serviceBayId);
      if (!bay) throw new DomainError('NOT_FOUND', 'Service bay not found');
      fail(checkPinnedBay(bay, serviceType, ctx.dealershipId));
    }
  }
}

/** sha256 over a canonical (sorted-key) form of the request; the instant is normalised to UTC. */
function hashRequest(
  ctx: SiteContext,
  cmd: BookAppointmentCommand,
  start: DateTime,
  channel: BookingChannel,
): string {
  const canonical = {
    channel,
    customerId: cmd.customerId,
    dealershipId: ctx.dealershipId,
    serviceBayId: cmd.serviceBayId ?? null,
    serviceTypeId: cmd.serviceTypeId,
    startAt: start.toUTC().toISO(),
    technicianId: cmd.technicianId ?? null,
    vehicleId: cmd.vehicleId,
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
