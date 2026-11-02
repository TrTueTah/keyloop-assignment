import { DateTime } from 'luxon';
import { interval, minutesOf, overlaps } from '../../../src/domain/interval';

const t = (hhmm: string) => DateTime.fromISO(`2026-11-10T${hhmm}:00Z`, { zone: 'utc' });
const iv = (a: string, b: string) => interval(t(a), t(b));

describe('interval (half-open [start, end))', () => {
  it('treats touching intervals as NOT overlapping', () => {
    expect(overlaps(iv('10:00', '11:00'), iv('11:00', '12:00'))).toBe(false);
    expect(overlaps(iv('11:00', '12:00'), iv('10:00', '11:00'))).toBe(false);
  });

  it('detects nested, partial-left, partial-right and identical overlaps', () => {
    expect(overlaps(iv('10:00', '12:00'), iv('10:30', '11:00'))).toBe(true);
    expect(overlaps(iv('10:00', '11:00'), iv('09:30', '10:15'))).toBe(true);
    expect(overlaps(iv('10:00', '11:00'), iv('10:45', '11:30'))).toBe(true);
    expect(overlaps(iv('10:00', '11:00'), iv('10:00', '11:00'))).toBe(true);
  });

  it('detects no overlap when separated by a gap', () => {
    expect(overlaps(iv('08:00', '09:00'), iv('09:15', '10:00'))).toBe(false);
  });

  it('rejects empty or inverted intervals', () => {
    expect(() => iv('10:00', '10:00')).toThrow();
    expect(() => iv('11:00', '10:00')).toThrow();
  });

  it('computes length in minutes', () => {
    expect(minutesOf(iv('10:00', '11:30'))).toBe(90);
  });
});
