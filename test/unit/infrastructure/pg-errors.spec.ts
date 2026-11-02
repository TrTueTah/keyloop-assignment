import { QueryFailedError } from 'typeorm';
import { toConflict } from '../../../src/infrastructure/persistence/pg-errors';

const pgError = (code: string, constraint?: string) =>
  new QueryFailedError('INSERT …', [], Object.assign(new Error('boom'), { code, constraint }));

/** Pins the constraint-name → typed outcome contract (Constitution V, research R2). */
describe('pg-errors.toConflict', () => {
  it.each([
    ['23P01', 'no_technician_overlap', 'technician'],
    ['23P01', 'no_bay_overlap', 'bay'],
    ['23P01', 'no_vehicle_overlap', 'vehicle'],
    ['23505', 'uq_appt_idempotency', 'idempotency_key'],
    ['40P01', undefined, 'transient'], // deadlock_detected between concurrent exclusion checks
    ['40001', undefined, 'transient'], // serialization_failure
  ])('%s on %s → conflict on %s', (code, constraint, on) => {
    expect(toConflict(pgError(code, constraint))).toEqual({ kind: 'conflict', on });
  });

  it.each([
    ['23P01', 'some_other_exclusion'],
    ['23505', 'uq_vehicle_vin'],
    ['23503', 'fk_appt_tech'],
    ['23514', 'valid_interval'],
    ['23P01', undefined],
  ])('%s on %s is not a known conflict (rethrown as 500)', (code, constraint) => {
    expect(toConflict(pgError(code, constraint))).toBeNull();
  });

  it('ignores non-database errors', () => {
    expect(toConflict(new Error('x'))).toBeNull();
    expect(toConflict(undefined)).toBeNull();
  });
});
