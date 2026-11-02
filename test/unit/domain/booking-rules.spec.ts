import { DateTime } from 'luxon';
import { validateRequestedSlot } from '../../../src/domain/booking-rules';
import { Dealership } from '../../../src/domain/model/dealership';

const leeds: Dealership = {
  id: 'd',
  tenantId: 't',
  name: 'Leeds',
  timezone: 'Europe/London',
  openingHours: [1, 2, 3, 4, 5].map((weekday) => ({
    weekday,
    opensAt: '08:00',
    closesAt: '17:00',
  })),
};
const now = DateTime.fromISO('2026-11-09T09:00:00Z'); // Monday
const at = (iso: string) => DateTime.fromISO(iso, { setZone: true });

describe('validateRequestedSlot (FR-007)', () => {
  it('accepts a valid future, on-grid slot inside opening hours', () => {
    expect(validateRequestedSlot(now, at('2026-11-10T10:00:00Z'), 60, leeds)).toBeNull();
    expect(validateRequestedSlot(now, at('2026-11-10T16:00:00Z'), 60, leeds)).toBeNull(); // ends exactly at close
  });

  it('START_IN_PAST', () => {
    expect(validateRequestedSlot(now, at('2026-11-09T08:45:00Z'), 30, leeds)).toBe('START_IN_PAST');
    expect(validateRequestedSlot(now, at('2026-11-09T09:00:00Z'), 30, leeds)).toBe('START_IN_PAST');
  });

  it('NOT_ON_SLOT_GRID for off-grid minutes or seconds', () => {
    expect(validateRequestedSlot(now, at('2026-11-10T10:07:00Z'), 30, leeds)).toBe(
      'NOT_ON_SLOT_GRID',
    );
    expect(validateRequestedSlot(now, at('2026-11-10T10:00:30Z'), 30, leeds)).toBe(
      'NOT_ON_SLOT_GRID',
    );
  });

  it('OUTSIDE_BOOKING_HORIZON beyond 90 days', () => {
    expect(validateRequestedSlot(now, at('2027-02-08T10:00:00Z'), 30, leeds)).toBe(
      'OUTSIDE_BOOKING_HORIZON',
    );
    expect(validateRequestedSlot(now, at('2027-02-05T10:00:00Z'), 30, leeds)).toBeNull(); // Friday, 88 days
  });

  it('OUTSIDE_OPENING_HOURS when the service would run past closing (never truncated)', () => {
    expect(validateRequestedSlot(now, at('2026-11-10T16:30:00Z'), 60, leeds)).toBe(
      'OUTSIDE_OPENING_HOURS',
    );
    expect(validateRequestedSlot(now, at('2026-11-10T07:45:00Z'), 30, leeds)).toBe(
      'OUTSIDE_OPENING_HOURS',
    );
  });

  it('OUTSIDE_OPENING_HOURS on a closed day (Sunday)', () => {
    expect(validateRequestedSlot(now, at('2026-11-15T10:00:00Z'), 30, leeds)).toBe(
      'OUTSIDE_OPENING_HOURS',
    );
  });

  it('uses LOCAL time on DST days (08:00 BST = 07:00Z is open in summer)', () => {
    const summerNow = DateTime.fromISO('2026-06-29T06:00:00Z');
    expect(validateRequestedSlot(summerNow, at('2026-06-30T07:00:00Z'), 30, leeds)).toBeNull();
    expect(validateRequestedSlot(summerNow, at('2026-06-30T06:45:00Z'), 30, leeds)).toBe(
      'OUTSIDE_OPENING_HOURS',
    );
  });
});
