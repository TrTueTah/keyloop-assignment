/**
 * pnpm demo:race: fires 20 simultaneous bookings for the SAME slot at the "Acme Race Bay"
 * dealership (exactly 1 technician + 1 bay), each from a different customer/vehicle.
 * Expected: 201 × 1, 409 × 19 (SC-001). Every run picks a fresh random future slot.
 */
import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import {
  DEALERSHIP,
  RACE_DRIVERS,
  SERVICE_TYPE,
  TENANT,
} from '../src/infrastructure/persistence/seed/fixtures';

async function main(): Promise<void> {
  const api = process.env.API_URL ?? 'http://localhost:3000';
  const day = DateTime.now()
    .setZone('Europe/London')
    .plus({ days: 2 + Math.floor(Math.random() * 60) });
  const slot = day.set({
    hour: 8 + Math.floor(Math.random() * 8),
    minute: [0, 15, 30][Math.floor(Math.random() * 3)],
    second: 0,
    millisecond: 0,
  });
  const startAt = slot.toISO()!;
  console.log(`Racing 20 bookings for ${startAt} at Acme Race Bay (1 technician, 1 bay)…`);

  const results = await Promise.all(
    RACE_DRIVERS.map(async (d) => {
      const res = await fetch(`${api}/api/v1/dealerships/${DEALERSHIP.RACE}/appointments`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': TENANT.ACME,
          'x-user-id': `racer-${d.n}`,
          'idempotency-key': randomUUID(),
        },
        body: JSON.stringify({
          customerId: d.customerId,
          vehicleId: d.vehicleId,
          serviceTypeId: SERVICE_TYPE.OIL,
          startAt,
        }),
      });
      return { status: res.status, body: (await res.json()) as { id?: string; code?: string } };
    }),
  );

  const tally = new Map<string, number>();
  for (const r of results)
    tally.set(
      `${r.status}${r.body.code ? ` ${r.body.code}` : ''}`,
      (tally.get(`${r.status}${r.body.code ? ` ${r.body.code}` : ''}`) ?? 0) + 1,
    );
  for (const [k, v] of [...tally].sort()) console.log(`  ${k} × ${v}`);
  const winners = results.filter((r) => r.status === 201);
  console.log(
    winners.length === 1
      ? `✔ exactly one booking confirmed: ${winners[0].body.id}`
      : `✘ expected exactly one 201, got ${winners.length}`,
  );
  process.exit(winners.length === 1 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
