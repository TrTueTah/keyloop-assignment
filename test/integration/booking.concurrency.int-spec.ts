import {
  DEALERSHIP,
  SERVICE_TYPE,
  TECHNICIAN,
} from '../../src/infrastructure/persistence/seed/fixtures';
import { asAcme, createTestApp, TestApp } from '../setup/app';
import { sql, truncateTransactional } from '../setup/db';
import { at, bookPath, ensureExtraCustomers, futureWeekday } from '../setup/scheduling';

/**
 * SC-001: zero double bookings. The Race Bay dealership has exactly 1 technician and 1 bay, so 20
 * simultaneous bookings for the same slot can only ever produce ONE confirmed appointment. This is
 * proven against real PostgreSQL (exclusion constraints), never against fakes (Constitution III).
 */
describe('US1: concurrency (SC-001)', () => {
  let t: TestApp;
  let cars: { customerId: string; vehicleId: string }[];
  const day = futureWeekday(5);
  const EXTRA_TECH = '66666666-0000-0000-0000-000000000099';

  beforeAll(async () => {
    t = await createTestApp({ logLevel: 'warn' });
    cars = await ensureExtraCustomers(20);
  });
  afterAll(async () => {
    await sql(`DELETE FROM technician_skill WHERE technician_id = $1`, [EXTRA_TECH]);
    await sql(`DELETE FROM technician WHERE id = $1`, [EXTRA_TECH]);
    await t.close();
  });
  beforeEach(truncateTransactional);

  async function race(round: number) {
    const responses = await Promise.all(
      cars.map((car, i) =>
        t.http
          .post(bookPath(DEALERSHIP.RACE))
          .set(asAcme(`racer-${i}`))
          .set('Idempotency-Key', `race-${round}-${i}`)
          .send({ ...car, serviceTypeId: SERVICE_TYPE.OIL, startAt: at(day, '10:00') }),
      ),
    );
    const statuses = responses.map((r) => r.status);
    const rows = await sql(
      `SELECT id FROM appointment WHERE dealership_id = $1 AND status = 'CONFIRMED'`,
      [DEALERSHIP.RACE],
    );
    return {
      statuses,
      rows,
      codes: responses.filter((r) => r.status === 409).map((r) => r.body.code),
    };
  }

  it.each([1, 2, 3, 4, 5])(
    '1 technician + 1 bay, 20 parallel requests → exactly 1 × 201 and 19 × 409 (run %i)',
    async (round) => {
      const { statuses, rows, codes } = await race(round);
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(19);
      expect(new Set(codes)).toEqual(new Set(['SLOT_UNAVAILABLE']));
      expect(rows).toHaveLength(1);
    },
  );

  it('2 technicians + 1 bay → still exactly 1 success (the bay is the bottleneck)', async () => {
    await sql(
      `INSERT INTO technician (id, dealership_id, name, active) VALUES ($1, $2, 'Extra', true) ON CONFLICT DO NOTHING`,
      [EXTRA_TECH, DEALERSHIP.RACE],
    );
    await sql(
      `INSERT INTO technician_skill (technician_id, skill_id)
       SELECT $1, skill_id FROM technician_skill WHERE technician_id = $2 ON CONFLICT DO NOTHING`,
      [EXTRA_TECH, TECHNICIAN.RACE_HAL],
    );
    for (const round of [11, 12, 13]) {
      await truncateTransactional();
      const { statuses, rows } = await race(round);
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(rows).toHaveLength(1);
    }
  });
});
