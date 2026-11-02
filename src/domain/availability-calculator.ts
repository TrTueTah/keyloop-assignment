import { DateTime } from 'luxon';
import { Interval, interval, overlaps } from './interval';
import { slotStarts } from './slot-grid';

export const ALTERNATIVES_MAX = 5;
export const ALTERNATIVES_DAYS_AHEAD = 7;

/** A resource with its CONFIRMED busy intervals. */
export interface ResourceSchedule {
  readonly id: string;
  readonly busy: readonly Interval[];
}

export interface Slot {
  readonly startAt: DateTime;
  readonly endAt: DateTime;
  readonly availableTechnicians: number;
  readonly availableBays: number;
}

export interface SlotBounds {
  /** Starts at or before this instant are not offered (e.g. "now"). */
  readonly notBefore?: DateTime;
  /** Starts after this instant are not offered (e.g. the booking horizon). */
  readonly notAfter?: DateTime;
}

const freeCount = (resources: readonly ResourceSchedule[], slot: Interval) =>
  resources.filter((r) => !r.busy.some((b) => overlaps(b, slot))).length;

/**
 * FR-011: every grid start inside the window where at least one qualified technician AND at least
 * one compatible bay are free for the whole duration. Pure and in-memory (data already loaded).
 */
export function computeSlots(
  window: Interval | null,
  durationMinutes: number,
  technicians: readonly ResourceSchedule[],
  bays: readonly ResourceSchedule[],
  bounds: SlotBounds = {},
): Slot[] {
  if (!window || technicians.length === 0 || bays.length === 0) return [];
  const out: Slot[] = [];
  for (const start of slotStarts(window, durationMinutes)) {
    if (bounds.notBefore && start.toMillis() <= bounds.notBefore.toMillis()) continue;
    if (bounds.notAfter && start.toMillis() > bounds.notAfter.toMillis()) continue;
    const slot = interval(start, start.plus({ minutes: durationMinutes }));
    const availableTechnicians = freeCount(technicians, slot);
    const availableBays = freeCount(bays, slot);
    if (availableTechnicians > 0 && availableBays > 0) {
      out.push({ startAt: slot.start, endAt: slot.end, availableTechnicians, availableBays });
    }
  }
  return out;
}

export interface AlternativesQuery extends SlotBounds {
  readonly requestedStart: DateTime;
  readonly durationMinutes: number;
  /** Opening windows from the requested local day onwards (index 0 = requested day). */
  readonly windows: readonly (Interval | null)[];
  readonly technicians: readonly ResourceSchedule[];
  readonly bays: readonly ResourceSchedule[];
  readonly max?: number;
}

/**
 * FR-012 / A10: up to 5 alternatives. Same day first (later slots ascending, then earlier slots
 * nearest-first), then the following days in order. Never the requested start itself.
 */
export function findAlternatives(q: AlternativesQuery): Slot[] {
  const max = q.max ?? ALTERNATIVES_MAX;
  const requested = q.requestedStart.toMillis();
  const [sameDayWindow, ...laterWindows] = q.windows;
  const sameDay = computeSlots(
    sameDayWindow ?? null,
    q.durationMinutes,
    q.technicians,
    q.bays,
    q,
  ).filter((s) => s.startAt.toMillis() !== requested);
  const ordered: Slot[] = [
    ...sameDay.filter((s) => s.startAt.toMillis() > requested),
    ...sameDay.filter((s) => s.startAt.toMillis() < requested).reverse(),
  ];
  for (const w of laterWindows) {
    if (ordered.length >= max) break;
    ordered.push(...computeSlots(w, q.durationMinutes, q.technicians, q.bays, q));
  }
  return ordered.slice(0, max);
}
