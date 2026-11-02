import { DateTime } from 'luxon';
import { computeSlots, findAlternatives } from '../../../src/domain/availability-calculator';
import { interval, Interval } from '../../../src/domain/interval';
import { openingWindow } from '../../../src/domain/time';
import { OpeningHours } from '../../../src/domain/model/dealership';

const Z = 'Europe/London';
const hours: OpeningHours[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  opensAt: '08:00',
  closesAt: '17:00',
}));
const t = (date: string, hhmm: string) => DateTime.fromISO(`${date}T${hhmm}`, { zone: Z });
const busy = (date: string, from: string, to: string): Interval =>
  interval(t(date, from), t(date, to));
const DAY = '2026-11-10'; // Tuesday
const window = openingWindow(DAY, Z, hours);
const hhmm = (d: DateTime) => d.setZone(Z).toFormat('HH:mm');

describe('computeSlots', () => {
  it('offers 08:00…16:00 for a 60-minute service when everything is free', () => {
    const slots = computeSlots(window, 60, [{ id: 't1', busy: [] }], [{ id: 'b1', busy: [] }]);
    expect(slots.map((s) => hhmm(s.startAt))[0]).toBe('08:00');
    expect(hhmm(slots[slots.length - 1].startAt)).toBe('16:00');
    expect(slots).toHaveLength(33);
    expect(slots[0]).toMatchObject({ availableTechnicians: 1, availableBays: 1 });
    expect(slots[0].endAt.diff(slots[0].startAt, 'minutes').minutes).toBe(60);
  });

  it('removes starts where every technician OR every bay is busy for part of the duration', () => {
    const slots = computeSlots(
      window,
      60,
      [{ id: 't1', busy: [busy(DAY, '10:00', '11:00')] }],
      [{ id: 'b1', busy: [busy(DAY, '13:00', '13:30')] }],
    ).map((s) => hhmm(s.startAt));
    for (const blocked of [
      '09:15',
      '09:45',
      '10:00',
      '10:45',
      '12:15',
      '12:45',
      '13:00',
      '13:15',
    ]) {
      expect(slots).not.toContain(blocked);
    }
    for (const open of ['09:00', '11:00', '12:00', '13:30']) expect(slots).toContain(open);
  });

  it('counts free technicians and bays per slot', () => {
    const [ten] = computeSlots(
      window,
      30,
      [
        { id: 't1', busy: [busy(DAY, '10:00', '10:30')] },
        { id: 't2', busy: [] },
        { id: 't3', busy: [] },
      ],
      [
        { id: 'b1', busy: [] },
        { id: 'b2', busy: [busy(DAY, '09:00', '12:00')] },
      ],
    ).filter((s) => hhmm(s.startAt) === '10:00');
    expect(ten).toMatchObject({ availableTechnicians: 2, availableBays: 1 });
  });

  it('returns nothing on a closed day or when no resources qualify', () => {
    expect(computeSlots(null, 60, [{ id: 't', busy: [] }], [{ id: 'b', busy: [] }])).toEqual([]);
    expect(computeSlots(window, 60, [], [{ id: 'b', busy: [] }])).toEqual([]);
  });

  it('hides starts at or before notBefore (no past slots today)', () => {
    const slots = computeSlots(window, 30, [{ id: 't', busy: [] }], [{ id: 'b', busy: [] }], {
      notBefore: t(DAY, '12:10'),
    });
    expect(hhmm(slots[0].startAt)).toBe('12:15');
  });

  it('follows LOCAL opening hours on DST change days', () => {
    const allWeek: OpeningHours[] = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
      weekday,
      opensAt: '08:00',
      closesAt: '17:00',
    }));
    for (const date of ['2026-03-29', '2026-10-25']) {
      const slots = computeSlots(
        openingWindow(date, Z, allWeek),
        60,
        [{ id: 't', busy: [] }],
        [{ id: 'b', busy: [] }],
      );
      expect(hhmm(slots[0].startAt)).toBe('08:00');
      expect(hhmm(slots[slots.length - 1].startAt)).toBe('16:00');
    }
  });
});

describe('findAlternatives (≤ 5; same day first, then up to 7 days ahead)', () => {
  const days = (start: string, n: number) =>
    Array.from({ length: n }, (_, i) =>
      openingWindow(DateTime.fromISO(start).plus({ days: i }).toISODate()!, Z, hours),
    );

  it('prefers later slots on the same day, then earlier same-day slots, then following days', () => {
    const tech = { id: 't', busy: [busy(DAY, '08:00', '10:00'), busy(DAY, '10:00', '15:30')] };
    const alternatives = findAlternatives({
      requestedStart: t(DAY, '10:00'),
      durationMinutes: 60,
      windows: days(DAY, 8),
      technicians: [tech],
      bays: [{ id: 'b', busy: [] }],
    });
    expect(alternatives.map((s) => s.startAt.setZone(Z).toFormat('MM-dd HH:mm'))).toEqual([
      '11-10 15:30',
      '11-10 15:45',
      '11-10 16:00',
      '11-11 08:00',
      '11-11 08:15',
    ]);
  });

  it('includes earlier same-day slots (nearest first) when nothing later is free', () => {
    const alternatives = findAlternatives({
      requestedStart: t(DAY, '16:00'),
      durationMinutes: 60,
      windows: [window],
      technicians: [{ id: 't', busy: [busy(DAY, '10:00', '17:00')] }],
      bays: [{ id: 'b', busy: [] }],
    });
    expect(alternatives.map((s) => hhmm(s.startAt))).toEqual([
      '09:00',
      '08:45',
      '08:30',
      '08:15',
      '08:00',
    ]);
  });

  it('never suggests the requested start itself and caps at 5', () => {
    const alternatives = findAlternatives({
      requestedStart: t(DAY, '10:00'),
      durationMinutes: 30,
      windows: days(DAY, 8),
      technicians: [{ id: 't', busy: [busy(DAY, '10:00', '10:30')] }],
      bays: [{ id: 'b', busy: [] }],
    });
    expect(alternatives).toHaveLength(5);
    expect(alternatives.map((s) => hhmm(s.startAt))).not.toContain('10:00');
  });

  it('returns [] when nothing is free in the search window', () => {
    expect(
      findAlternatives({
        requestedStart: t(DAY, '10:00'),
        durationMinutes: 60,
        windows: days(DAY, 8),
        technicians: [],
        bays: [{ id: 'b', busy: [] }],
      }),
    ).toEqual([]);
  });

  it('respects notBefore / notAfter (no past, no beyond-horizon suggestions)', () => {
    const alternatives = findAlternatives({
      requestedStart: t(DAY, '10:00'),
      durationMinutes: 60,
      windows: days(DAY, 8),
      technicians: [{ id: 't', busy: [busy(DAY, '08:00', '17:00')] }],
      bays: [{ id: 'b', busy: [] }],
      notAfter: t('2026-11-11', '09:00'),
    });
    expect(alternatives.map((s) => s.startAt.setZone(Z).toFormat('MM-dd HH:mm'))).toEqual([
      '11-11 08:00',
      '11-11 08:15',
      '11-11 08:30',
      '11-11 08:45',
      '11-11 09:00',
    ]);
  });
});
