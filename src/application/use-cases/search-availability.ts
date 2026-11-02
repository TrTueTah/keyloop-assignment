import { computeSlots, Slot } from '../../domain/availability-calculator';
import { BOOKING_HORIZON_DAYS } from '../../domain/booking-rules';
import { DomainError } from '../../domain/errors';
import { localDayBounds, openingWindow } from '../../domain/time';
import { Clock } from '../ports/clock';
import { ReferenceQuery } from '../ports/reference.query';
import { ResourceQuery } from '../ports/resource.query';
import { Telemetry } from '../ports/telemetry';
import { SiteContext } from '../tenant-context';

export interface SlotView {
  readonly startAt: string;
  readonly endAt: string;
  readonly availableTechnicians: number;
  readonly availableBays: number;
}

export interface AvailabilityResult {
  readonly dealershipId: string;
  readonly serviceTypeId: string;
  readonly date: string;
  readonly timezone: string;
  readonly slots: SlotView[];
}

/** Renders a slot with the dealership's local offset (FR-013). */
export function toSlotView(s: Slot, zone: string): SlotView {
  const iso = (d: Slot['startAt']) => d.setZone(zone).toISO({ suppressMilliseconds: true })!;
  return {
    startAt: iso(s.startAt),
    endAt: iso(s.endAt),
    availableTechnicians: s.availableTechnicians,
    availableBays: s.availableBays,
  };
}

/** FR-011: free start times for a service type on a dealership-local date (advisory snapshot). */
export class SearchAvailability {
  constructor(
    private readonly reference: ReferenceQuery,
    private readonly resources: ResourceQuery,
    private readonly clock: Clock,
    private readonly telemetry: Telemetry,
  ) {}

  async execute(
    ctx: SiteContext,
    serviceTypeId: string,
    date: string,
  ): Promise<AvailabilityResult> {
    const dealership = await this.reference.findDealershipInTenant(ctx.tenantId, ctx.dealershipId);
    if (!dealership) throw new DomainError('NOT_FOUND', 'Dealership not found');
    const serviceType = await this.reference.getServiceType(ctx, serviceTypeId);
    if (!serviceType) throw new DomainError('NOT_FOUND', 'Service type not found');

    const zone = dealership.timezone;
    const day = localDayBounds(date, zone);
    const snapshot = await this.resources.availabilitySnapshot(ctx, serviceType, day);
    const now = this.clock.now();
    const slots = await this.telemetry.span(
      'computeAvailability',
      { duration: serviceType.durationMinutes },
      () =>
        computeSlots(
          openingWindow(date, zone, dealership.openingHours),
          serviceType.durationMinutes,
          snapshot.technicians,
          snapshot.bays,
          {
            notBefore: now,
            notAfter: now.plus({ days: BOOKING_HORIZON_DAYS }),
          },
        ),
    );
    this.telemetry.observe('availability_slots_returned', slots.length);
    return {
      dealershipId: dealership.id,
      serviceTypeId: serviceType.id,
      date,
      timezone: zone,
      slots: slots.map((s) => toSlotView(s, zone)),
    };
  }
}
