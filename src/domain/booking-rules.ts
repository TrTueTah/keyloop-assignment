import { DateTime } from 'luxon';
import { ErrorCode } from './errors';
import { contains, interval } from './interval';
import { Dealership } from './model/dealership';
import { isOnGrid, localDateOf, openingWindow } from './time';

export const BOOKING_HORIZON_DAYS = 90;

/**
 * FR-007 request-slot rules, evaluated in the dealership's local time. Returns the first violated
 * rule's code, or null. `now` is supplied by the caller (Clock port).
 */
export function validateRequestedSlot(
  now: DateTime,
  start: DateTime,
  durationMinutes: number,
  dealership: Dealership,
): ErrorCode | null {
  if (start.toMillis() <= now.toMillis()) return 'START_IN_PAST';
  if (!isOnGrid(start, dealership.timezone)) return 'NOT_ON_SLOT_GRID';
  if (start.toMillis() > now.plus({ days: BOOKING_HORIZON_DAYS }).toMillis())
    return 'OUTSIDE_BOOKING_HORIZON';

  const window = openingWindow(
    localDateOf(start, dealership.timezone),
    dealership.timezone,
    dealership.openingHours,
  );
  const requested = interval(start, start.plus({ minutes: durationMinutes }));
  if (!window || !contains(window, requested)) return 'OUTSIDE_OPENING_HOURS';
  return null;
}
