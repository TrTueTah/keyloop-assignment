/**
 * pnpm perf:smoke: dependency-free latency smoke test against a running stack (SC-004 / plan goals).
 * 1,000 availability searches + 200 booking attempts at concurrency 20; prints p50/p95 and warns
 * when availability p95 ≥ 300 ms or booking p95 ≥ 500 ms. Not a benchmark: a sanity check.
 */
import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import {
  DEALERSHIP,
  RACE_DRIVERS,
  SERVICE_TYPE,
  TENANT,
} from '../src/infrastructure/persistence/seed/fixtures';

const api = process.env.API_URL ?? 'http://localhost:3000';
const headers = {
  'content-type': 'application/json',
  'x-tenant-id': TENANT.ACME,
  'x-user-id': 'perf',
};
const zone = 'Europe/London';

async function pool<T>(
  n: number,
  concurrency: number,
  task: (i: number) => Promise<T>,
): Promise<T[]> {
  const out: T[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < n) {
        const i = next++;
        out[i] = await task(i);
      }
    }),
  );
  return out;
}

async function timed(fn: () => Promise<Response>): Promise<{ ms: number; status: number }> {
  const t0 = performance.now();
  const res = await fn();
  await res.arrayBuffer();
  return { ms: performance.now() - t0, status: res.status };
}

const pct = (xs: number[], p: number) =>
  [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];

async function main(): Promise<void> {
  const weekday = (offset: number) => {
    let d = DateTime.now()
      .setZone(zone)
      .plus({ days: 2 + offset });
    while (d.weekday > 5) d = d.plus({ days: 1 });
    return d.toISODate()!;
  };

  const availability = await pool(1000, 20, (i) =>
    timed(() =>
      fetch(
        `${api}/api/v1/dealerships/${DEALERSHIP.LEEDS}/availability?serviceTypeId=${SERVICE_TYPE.OIL}&date=${weekday(i % 30)}`,
        { headers },
      ),
    ),
  );
  const bookings = await pool(200, 20, (i) => {
    const d = RACE_DRIVERS[i % RACE_DRIVERS.length];
    const start = DateTime.fromISO(
      `${weekday(i % 40)}T${String(8 + (i % 8)).padStart(2, '0')}:${['00', '15', '30', '45'][i % 4]}`,
      { zone },
    );
    return timed(() =>
      fetch(`${api}/api/v1/dealerships/${DEALERSHIP.RACE}/appointments`, {
        method: 'POST',
        headers: { ...headers, 'idempotency-key': randomUUID() },
        body: JSON.stringify({
          customerId: d.customerId,
          vehicleId: d.vehicleId,
          serviceTypeId: SERVICE_TYPE.OIL,
          startAt: start.toISO(),
        }),
      }),
    );
  });

  let ok = true;
  for (const [name, rows, budget] of [
    ['availability', availability, 300],
    ['booking', bookings, 500],
  ] as const) {
    const ms = rows.map((r) => r.ms);
    const statuses = [...new Set(rows.map((r) => r.status))].sort().join(',');
    const p95 = pct(ms, 95);
    console.log(
      `${name.padEnd(12)} n=${rows.length} p50=${pct(ms, 50).toFixed(1)}ms p95=${p95.toFixed(1)}ms statuses=${statuses}`,
    );
    if (p95 >= budget) {
      ok = false;
      console.warn(`  ⚠ ${name} p95 ${p95.toFixed(1)}ms ≥ ${budget}ms target`);
    }
    if (rows.some((r) => r.status >= 500)) {
      ok = false;
      console.warn(`  ⚠ ${name} returned 5xx`);
    }
  }
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
