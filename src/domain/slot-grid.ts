import { DateTime } from 'luxon';
import { Interval } from './interval';
import { SLOT_STEP_MINUTES } from './time';

/**
 * Every grid-aligned start within the window where [start, start + duration) still fits.
 * The first start is the window start rounded up to the next local grid minute.
 */
export function slotStarts(
  window: Interval,
  durationMinutes: number,
  stepMinutes = SLOT_STEP_MINUTES,
): DateTime[] {
  const startLocal = window.start;
  const remainder = startLocal.minute % stepMinutes;
  let cursor = startLocal.set({ second: 0, millisecond: 0 });
  if (remainder !== 0 || startLocal.second !== 0 || startLocal.millisecond !== 0) {
    cursor = cursor.plus({ minutes: stepMinutes - remainder });
  }
  const result: DateTime[] = [];
  while (cursor.plus({ minutes: durationMinutes }).toMillis() <= window.end.toMillis()) {
    result.push(cursor);
    cursor = cursor.plus({ minutes: stepMinutes });
  }
  return result;
}
