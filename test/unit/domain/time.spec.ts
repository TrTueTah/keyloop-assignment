import { DateTime } from 'luxon';
import { isOnGrid, localDateOf, localDayBounds, openingWindow } from '../../../src/domain/time';
import { slotStarts } from '../../../src/domain/slot-grid';
import { OpeningHours } from '../../../src/domain/model/dealership';

const LONDON = 'Europe/London';
const weekdays: OpeningHours[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  opensAt: '08:00',
  closesAt: '17:00',
}));
const allWeek: OpeningHours[] = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday,
  opensAt: '08:00',
  closesAt: '17:00',
}));

describe('time (dealership-local rules)', () => {
  it('local day bounds are 24h on a normal day', () => {
    const d = localDayBounds('2026-11-10', LONDON);
    expect(d.end.diff(d.start, 'hours').hours).toBe(24);
    expect(d.start.toISO()).toBe('2026-11-10T00:00:00.000+00:00');
  });

  it('local day is 23h on the spring-forward day (2026-03-29)', () => {
    const d = localDayBounds('2026-03-29', LONDON);
    expect(d.end.diff(d.start, 'hours').hours).toBe(23);
  });

  it('local day is 25h on the fall-back day (2026-10-25)', () => {
    const d = localDayBounds('2026-10-25', LONDON);
    expect(d.end.diff(d.start, 'hours').hours).toBe(25);
  });

  it('opening window follows LOCAL wall-clock time across DST (BST vs GMT)', () => {
    const summer = openingWindow('2026-07-01', LONDON, weekdays)!;
    expect(summer.start.toUTC().toISO()).toBe('2026-07-01T07:00:00.000Z'); // 08:00 BST
    const winter = openingWindow('2026-11-10', LONDON, weekdays)!;
    expect(winter.start.toUTC().toISO()).toBe('2026-11-10T08:00:00.000Z'); // 08:00 GMT
    const springForward = openingWindow('2026-03-29', LONDON, allWeek)!;
    expect(springForward.start.toUTC().toISO()).toBe('2026-03-29T07:00:00.000Z');
    expect(springForward.end.diff(springForward.start, 'hours').hours).toBe(9);
  });

  it('returns null for a closed weekday', () => {
    expect(openingWindow('2026-11-08', LONDON, weekdays)).toBeNull(); // Sunday
  });

  it('isOnGrid accepts local :00/:15/:30/:45 with zero seconds only', () => {
    const at = (iso: string) => DateTime.fromISO(iso, { setZone: true });
    expect(isOnGrid(at('2026-11-10T10:00:00Z'), LONDON)).toBe(true);
    expect(isOnGrid(at('2026-11-10T10:45:00Z'), LONDON)).toBe(true);
    expect(isOnGrid(at('2026-11-10T10:07:00Z'), LONDON)).toBe(false);
    expect(isOnGrid(at('2026-11-10T10:00:30Z'), LONDON)).toBe(false);
    expect(isOnGrid(at('2026-11-10T10:00:00.500Z'), LONDON)).toBe(false);
  });

  it('localDateOf uses the dealership zone (00:30 BST is the previous UTC day)', () => {
    const instant = DateTime.fromISO('2026-07-01T23:30:00Z');
    expect(localDateOf(instant, LONDON)).toBe('2026-07-02');
  });
});

describe('slotStarts', () => {
  it('produces 15-minute starts from open until the last start that still fits', () => {
    const w = openingWindow('2026-11-10', LONDON, weekdays)!;
    const starts = slotStarts(w, 60, 15).map((s) => s.setZone(LONDON).toFormat('HH:mm'));
    expect(starts[0]).toBe('08:00');
    expect(starts[starts.length - 1]).toBe('16:00');
    expect(starts).toHaveLength(33); // 08:00..16:00 every 15 min
  });

  it('returns nothing when the service is longer than the window', () => {
    const w = openingWindow('2026-11-10', LONDON, [
      { weekday: 2, opensAt: '08:00', closesAt: '09:00' },
    ])!;
    expect(slotStarts(w, 90, 15)).toEqual([]);
  });
});
