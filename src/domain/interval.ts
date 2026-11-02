import { DateTime } from 'luxon';

/** A half-open time interval [start, end). */
export interface Interval {
  readonly start: DateTime;
  readonly end: DateTime;
}

export function interval(start: DateTime, end: DateTime): Interval {
  if (!(end.toMillis() > start.toMillis())) {
    throw new Error('Interval end must be after start');
  }
  return { start, end };
}

/** Half-open overlap: [a.start, a.end) and [b.start, b.end) share at least one instant. */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start.toMillis() < b.end.toMillis() && b.start.toMillis() < a.end.toMillis();
}

export function contains(outer: Interval, inner: Interval): boolean {
  return (
    inner.start.toMillis() >= outer.start.toMillis() && inner.end.toMillis() <= outer.end.toMillis()
  );
}

export function minutesOf(i: Interval): number {
  return Math.round((i.end.toMillis() - i.start.toMillis()) / 60_000);
}
