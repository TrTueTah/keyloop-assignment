import { ALTERNATIVES_DAYS_AHEAD, findAlternatives } from '../../domain/availability-calculator';
import { BOOKING_HORIZON_DAYS } from '../../domain/booking-rules';
import { DomainErrorMeta } from '../../domain/errors';
import { interval } from '../../domain/interval';
import { Dealership } from '../../domain/model/dealership';
import { ServiceType } from '../../domain/model/service-type';
import { DateTime, localDateOf, localDayBounds, openingWindow } from '../../domain/time';
import { Clock } from '../ports/clock';
import { ResourceQuery } from '../ports/resource.query';
import { Telemetry } from '../ports/telemetry';
import { SiteContext } from '../tenant-context';
import { toSlotView } from './search-availability';

/**
 * FR-012 / A10: alternatives for a refused time. One snapshot query covers the requested local day
 * plus 7 days ahead (bounded, Constitution VIII); nothing is booked automatically.
 */
export class FindAlternatives {
  constructor(
    private readonly resources: ResourceQuery,
    private readonly clock: Clock,
    private readonly telemetry: Telemetry,
  ) {}

  async execute(
    ctx: SiteContext,
    serviceType: ServiceType,
    dealership: Dealership,
    requestedStart: DateTime,
  ): Promise<NonNullable<DomainErrorMeta['alternatives']>> {
    return this.telemetry.span('findAlternatives', {}, async () => {
      const zone = dealership.timezone;
      const firstDay = localDayBounds(localDateOf(requestedStart, zone), zone);
      const dates = Array.from({ length: ALTERNATIVES_DAYS_AHEAD + 1 }, (_, i) =>
        firstDay.start.plus({ days: i }).toISODate()!,
      );
      const range = interval(firstDay.start, localDayBounds(dates[dates.length - 1], zone).end);
      const snapshot = await this.resources.availabilitySnapshot(ctx, serviceType, range);
      const now = this.clock.now();
      const slots = findAlternatives({
        requestedStart,
        durationMinutes: serviceType.durationMinutes,
        windows: dates.map((d) => openingWindow(d, zone, dealership.openingHours)),
        technicians: snapshot.technicians,
        bays: snapshot.bays,
        notBefore: now,
        notAfter: now.plus({ days: BOOKING_HORIZON_DAYS }),
      });
      return slots.map((s) => toSlotView(s, zone));
    });
  }
}
