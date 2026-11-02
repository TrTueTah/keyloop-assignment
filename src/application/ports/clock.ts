import { DateTime } from '../../domain/time';

/** The only source of "now" for domain and application code (Constitution IV). */
export interface Clock {
  now(): DateTime;
}
export const CLOCK = Symbol('CLOCK');
