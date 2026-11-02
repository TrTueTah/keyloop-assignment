import { DateTime } from 'luxon';
import { randomUUID } from 'node:crypto';
import {
  CUSTOMER,
  DEALERSHIP,
  RACE_DRIVERS,
  SERVICE_TYPE,
  TENANT,
  VEHICLE,
} from '../../src/infrastructure/persistence/seed/fixtures';
import { sql } from './db';

export const LONDON = 'Europe/London';

/** A Mon–Fri local date at least `minDaysAhead` days in the future (avoids "in the past" flakiness). */
export function futureWeekday(minDaysAhead = 3, nth = 0): string {
  let d = DateTime.now().setZone(LONDON).startOf('day').plus({ days: minDaysAhead });
  let found = 0;
  for (;;) {
    if (d.weekday <= 5) {
      if (found === nth) return d.toISODate()!;
      found += 1;
    }
    d = d.plus({ days: 1 });
  }
}

/** Dealership-local wall-clock time → ISO with offset. */
export const at = (date: string, hhmm: string) =>
  DateTime.fromISO(`${date}T${hhmm}`, { zone: LONDON }).toISO()!;

export interface BookingBody {
  customerId: string;
  vehicleId: string;
  serviceTypeId: string;
  startAt: string;
  [k: string]: unknown;
}

export const body = (startAt: string, over: Partial<BookingBody> = {}): BookingBody => ({
  customerId: CUSTOMER.ALICE_SMITH,
  vehicleId: VEHICLE.SMITH_GOLF,
  serviceTypeId: SERVICE_TYPE.OIL,
  startAt,
  ...over,
});

export const bookPath = (dealershipId: string = DEALERSHIP.LEEDS) =>
  `/api/v1/dealerships/${dealershipId}/appointments`;

/** Inserts a CONFIRMED appointment directly (fixture setup that bypasses the API). */
export async function insertAppointment(row: {
  technicianId: string;
  serviceBayId: string;
  start: string;
  end: string;
  vehicleId?: string;
  customerId?: string;
  dealershipId?: string;
  serviceTypeId?: string;
  status?: string;
}): Promise<string> {
  const [r] = await sql<{ id: string }>(
    `INSERT INTO appointment (tenant_id, dealership_id, customer_id, vehicle_id, service_type_id, technician_id,
        service_bay_id, start_at, end_at, status, assignment_mode, created_by, idempotency_key, request_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'AUTO','fixture',$11, repeat('0',64)) RETURNING id`,
    [
      TENANT.ACME,
      row.dealershipId ?? DEALERSHIP.LEEDS,
      row.customerId ?? CUSTOMER.CHLOE_BROWN,
      row.vehicleId ?? VEHICLE.BROWN_FIESTA,
      row.serviceTypeId ?? SERVICE_TYPE.OIL,
      row.technicianId,
      row.serviceBayId,
      row.start,
      row.end,
      row.status ?? 'CONFIRMED',
      `fixture-${randomUUID()}`,
    ],
  );
  return r.id;
}

/** N seeded Acme customers, each with one vehicle (distinct vehicles for concurrency tests). */
export async function ensureExtraCustomers(
  n: number,
): Promise<{ customerId: string; vehicleId: string }[]> {
  if (n > RACE_DRIVERS.length)
    throw new Error(`only ${RACE_DRIVERS.length} race drivers are seeded`);
  return RACE_DRIVERS.slice(0, n).map(({ customerId, vehicleId }) => ({ customerId, vehicleId }));
}
