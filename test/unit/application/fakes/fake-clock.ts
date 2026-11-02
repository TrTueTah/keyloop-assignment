// NOT evidence for DB guarantees (Constitution III): orchestration-only test double.
import { DateTime } from 'luxon';
import { Clock } from '../../../../src/application/ports/clock';

export class FakeClock implements Clock {
  constructor(
    private current: DateTime = DateTime.fromISO('2026-11-09T09:00:00Z', { zone: 'utc' }),
  ) {}
  now(): DateTime {
    return this.current;
  }
  set(iso: string): void {
    this.current = DateTime.fromISO(iso, { zone: 'utc' });
  }
}
