import { DateTime } from 'luxon';
import { Interval, interval } from './interval';
import { OpeningHours } from './model/dealership';

/**
 * Dealership-local time rules (Constitution I, research R9). Pure functions: "now" is always
 * passed in by the caller (from the Clock port); nothing here reads the system clock.
 */
export { DateTime };

export const SLOT_STEP_MINUTES = 15;

/** [00:00 local, next 00:00 local) for an ISO date (yyyy-MM-dd) in the given zone. */
export function localDayBounds(date: string, zone: string): Interval {
  const start = DateTime.fromISO(date, { zone }).startOf('day');
  if (!start.isValid) throw new Error(`Invalid date or zone: ${date} ${zone}`);
  return interval(start, start.plus({ days: 1 }).startOf('day'));
}

export function localDateOf(instant: DateTime, zone: string): string {
  return instant.setZone(zone).toISODate()!;
}

/** The opening window for a local date, or null when the dealership is closed that weekday. */
export function openingWindow(
  date: string,
  zone: string,
  hours: readonly OpeningHours[],
): Interval | null {
  const day = DateTime.fromISO(date, { zone });
  if (!day.isValid) throw new Error(`Invalid date or zone: ${date} ${zone}`);
  const h = hours.find((x) => x.weekday === day.weekday);
  if (!h) return null;
  const at = (hhmm: string) => DateTime.fromISO(`${date}T${hhmm}`, { zone });
  return interval(at(h.opensAt), at(h.closesAt));
}

/** True when the instant is on the local 15-minute grid with zero seconds/milliseconds. */
export function isOnGrid(
  instant: DateTime,
  zone: string,
  stepMinutes = SLOT_STEP_MINUTES,
): boolean {
  const local = instant.setZone(zone);
  return local.second === 0 && local.millisecond === 0 && local.minute % stepMinutes === 0;
}
