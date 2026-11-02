import { DateTime } from 'luxon';
import { Clock } from '../../application/ports/clock';

/** The only place that reads the system clock (Constitution IV). */
export class SystemClock implements Clock {
  now(): DateTime {
    return DateTime.utc();
  }
}
