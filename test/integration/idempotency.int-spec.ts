import { DEALERSHIP, SERVICE_TYPE } from '../../src/infrastructure/persistence/seed/fixtures';
import { asAcme, createTestApp, TestApp } from '../setup/app';
import { sql, truncateTransactional } from '../setup/db';
import { at, body, bookPath, ensureExtraCustomers, futureWeekday } from '../setup/scheduling';

describe('US1: idempotent booking (FR-010, SC-003)', () => {
  let t: TestApp;
  const day = futureWeekday(6);
  const post = (b: object, key?: string, dealershipId?: string) => {
    const r = t.http.post(bookPath(dealershipId)).set(asAcme());
    return (key === undefined ? r : r.set('Idempotency-Key', key)).send(b);
  };

  beforeAll(async () => {
    t = await createTestApp({ logLevel: 'warn' });
  });
  afterAll(() => t.close());
  beforeEach(truncateTransactional);

  it('replays an identical request: 200 with the same appointment, no second row', async () => {
    const first = await post(body(at(day, '10:00')), 'idem-1').expect(201);
    const again = await post(body(at(day, '10:00')), 'idem-1').expect(200);
    expect(again.body).toEqual(first.body);
    expect(await sql(`SELECT 1 FROM appointment`)).toHaveLength(1);
  });

  it('same key with a different request → 422 IDEMPOTENCY_KEY_REUSED', async () => {
    await post(body(at(day, '10:00')), 'idem-2').expect(201);
    const res = await post(body(at(day, '11:00')), 'idem-2').expect(422);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('missing Idempotency-Key → 422 VALIDATION_FAILED', async () => {
    const res = await post(body(at(day, '10:00'))).expect(422);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.errors[0].field).toBe('Idempotency-Key');
  });

  // Run repeatedly: the first version of this test was green by luck while ~25% of runs deadlocked
  // into 500s (fixed by classifying 40P01 as a retryable `transient` conflict, research R2).
  it.each([1, 2, 3, 4, 5])(
    '20 simultaneous identical submissions → one appointment, same id everywhere (run %i)',
    async (run) => {
      const responses = await Promise.all(
        Array.from({ length: 20 }, () => post(body(at(day, '12:00')), `idem-burst-${run}`)),
      );
      expect(responses.map((r) => r.status).every((s) => s === 201 || s === 200)).toBe(true);
      expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
      expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
      expect(await sql(`SELECT 1 FROM appointment`)).toHaveLength(1);
    },
  );

  it('a key refused with 409 can succeed later once capacity frees up', async () => {
    const [car] = await ensureExtraCustomers(1);
    const raceBody = { ...car, serviceTypeId: SERVICE_TYPE.OIL, startAt: at(day, '14:00') };
    await post(
      { ...body(at(day, '14:00')), serviceTypeId: SERVICE_TYPE.OIL },
      'holder',
      DEALERSHIP.RACE,
    ).expect(201);
    await post(raceBody, 'retry-me', DEALERSHIP.RACE).expect(409);
    await sql(`UPDATE appointment SET status = 'CANCELLED' WHERE idempotency_key = 'holder'`);
    await post(raceBody, 'retry-me', DEALERSHIP.RACE).expect(201);
  });
});
