import { EntityManager } from 'typeorm';
import {
  AvailabilitySnapshot,
  BusyResource,
  CandidateQuery,
  Candidates,
  ResourceQuery,
} from '../../../application/ports/resource.query';
import { SiteContext, TenantContext } from '../../../application/tenant-context';
import { ResourceCandidate } from '../../../domain/allocation-policy';
import { Interval, interval } from '../../../domain/interval';
import { ServiceBay } from '../../../domain/model/service-bay';
import { ServiceType } from '../../../domain/model/service-type';
import { Technician } from '../../../domain/model/technician';
import { DateTime } from '../../../domain/time';
import { isUuid, queryRows } from './sql';

const toDt = (d: Date) => DateTime.fromJSDate(d, { zone: 'utc' });

/**
 * Candidate and availability queries. Each method issues a FIXED number of parameterised SQL
 * statements independent of slot count (Constitution VIII). Availability here is advisory; the
 * exclusion constraints decide on write (Constitution I).
 */
export class TypeOrmResourceQuery implements ResourceQuery {
  constructor(private readonly em: EntityManager) {}

  async findCandidates(ctx: SiteContext, q: CandidateQuery): Promise<Candidates> {
    const slot = [q.slot.start.toJSDate(), q.slot.end.toJSDate()];
    const day = [q.localDay.start.toJSDate(), q.localDay.end.toJSDate()];
    const bookedMinutes = (col: string, alias: string) => `
      COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (LEAST(a.end_at, $6) - GREATEST(a.start_at, $5))) / 60)
                  FROM appointment a
                 WHERE a.${col} = ${alias}.id AND a.status = 'CONFIRMED'
                   AND tstzrange(a.start_at, a.end_at, '[)') && tstzrange($5, $6, '[)')), 0)::int`;
    const isFree = (col: string, alias: string) => `
      NOT EXISTS (SELECT 1 FROM appointment a
                   WHERE a.${col} = ${alias}.id AND a.status = 'CONFIRMED'
                     AND tstzrange(a.start_at, a.end_at, '[)') && tstzrange($3, $4, '[)'))`;

    const technicians = await queryRows<{
      id: string;
      booked_minutes: number;
      capability_count: number;
    }>(
      this.em,
      `SELECT t.id,
              ${bookedMinutes('technician_id', 't')} AS booked_minutes,
              (SELECT COUNT(*) FROM technician_skill x WHERE x.technician_id = t.id)::int AS capability_count
         FROM technician t
         JOIN dealership d ON d.id = t.dealership_id AND d.tenant_id = $1
        WHERE t.dealership_id = $2 AND t.active
          AND EXISTS (SELECT 1 FROM technician_skill ts JOIN skill s ON s.id = ts.skill_id
                       WHERE ts.technician_id = t.id AND s.tenant_id = $1 AND s.code = $7)
          AND ${isFree('technician_id', 't')}
          AND NOT (t.id = ANY($8::uuid[]))
          AND ($9::uuid IS NULL OR t.id = $9::uuid)`,
      [
        ctx.tenantId,
        ctx.dealershipId,
        ...slot,
        ...day,
        q.serviceType.requiredSkill,
        [...q.excludeTechnicianIds],
        q.pinnedTechnicianId ?? null,
      ],
    );

    const bays = await queryRows<{ id: string; booked_minutes: number; capability_count: number }>(
      this.em,
      `SELECT b.id,
              ${bookedMinutes('service_bay_id', 'b')} AS booked_minutes,
              (SELECT COUNT(*) FROM service_bay_capability x WHERE x.service_bay_id = b.id)::int AS capability_count
         FROM service_bay b
         JOIN dealership d ON d.id = b.dealership_id AND d.tenant_id = $1
        WHERE b.dealership_id = $2 AND b.active
          AND $7::text[] <@ ARRAY(SELECT c.capability_code FROM service_bay_capability c WHERE c.service_bay_id = b.id)
          AND ${isFree('service_bay_id', 'b')}
          AND NOT (b.id = ANY($8::uuid[]))
          AND ($9::uuid IS NULL OR b.id = $9::uuid)`,
      [
        ctx.tenantId,
        ctx.dealershipId,
        ...slot,
        ...day,
        [...q.serviceType.requiredCapabilities],
        [...q.excludeBayIds],
        q.pinnedBayId ?? null,
      ],
    );

    const toCandidate = (r: {
      id: string;
      booked_minutes: number;
      capability_count: number;
    }): ResourceCandidate => ({
      id: r.id,
      bookedMinutes: Number(r.booked_minutes),
      capabilityCount: Number(r.capability_count),
    });
    return { technicians: technicians.map(toCandidate), bays: bays.map(toCandidate) };
  }

  async getTechnician(ctx: TenantContext, id: string): Promise<Technician | null> {
    if (!isUuid(id)) return null;
    const rows = await queryRows<{
      id: string;
      dealership_id: string;
      name: string;
      active: boolean;
      skills: string[];
    }>(
      this.em,
      `SELECT t.id, t.dealership_id, t.name, t.active,
              COALESCE(ARRAY(SELECT s.code FROM technician_skill ts JOIN skill s ON s.id = ts.skill_id
                              WHERE ts.technician_id = t.id ORDER BY s.code), '{}') AS skills
         FROM technician t JOIN dealership d ON d.id = t.dealership_id
        WHERE t.id = $1 AND d.tenant_id = $2`,
      [id, ctx.tenantId],
    );
    const r = rows[0];
    return r
      ? {
          id: r.id,
          dealershipId: r.dealership_id,
          name: r.name,
          active: r.active,
          skills: r.skills,
        }
      : null;
  }

  async getBay(ctx: TenantContext, id: string): Promise<ServiceBay | null> {
    if (!isUuid(id)) return null;
    const rows = await queryRows<{
      id: string;
      dealership_id: string;
      name: string;
      active: boolean;
      capabilities: string[];
    }>(
      this.em,
      `SELECT b.id, b.dealership_id, b.name, b.active,
              COALESCE(ARRAY(SELECT c.capability_code FROM service_bay_capability c
                              WHERE c.service_bay_id = b.id ORDER BY c.capability_code), '{}') AS capabilities
         FROM service_bay b JOIN dealership d ON d.id = b.dealership_id
        WHERE b.id = $1 AND d.tenant_id = $2`,
      [id, ctx.tenantId],
    );
    const r = rows[0];
    return r
      ? {
          id: r.id,
          dealershipId: r.dealership_id,
          name: r.name,
          active: r.active,
          capabilities: r.capabilities,
        }
      : null;
  }

  /**
   * ONE query for any range (a single day or the 7-day alternatives window), independent of slot
   * count (Constitution VIII): qualified technicians and compatible bays, each LEFT JOINed with its
   * CONFIRMED appointments overlapping the range.
   */
  async availabilitySnapshot(
    ctx: SiteContext,
    serviceType: ServiceType,
    range: Interval,
  ): Promise<AvailabilitySnapshot> {
    const rows = await queryRows<{
      kind: 'T' | 'B';
      id: string;
      start_at: Date | null;
      end_at: Date | null;
    }>(
      this.em,
      `SELECT 'T' AS kind, t.id, a.start_at, a.end_at
         FROM technician t
         JOIN dealership d ON d.id = t.dealership_id AND d.tenant_id = $1
         LEFT JOIN appointment a ON a.technician_id = t.id AND a.status = 'CONFIRMED'
                                AND tstzrange(a.start_at, a.end_at, '[)') && tstzrange($4, $5, '[)')
        WHERE t.dealership_id = $2 AND t.active
          AND EXISTS (SELECT 1 FROM technician_skill ts JOIN skill s ON s.id = ts.skill_id
                       WHERE ts.technician_id = t.id AND s.tenant_id = $1 AND s.code = $3)
       UNION ALL
       SELECT 'B' AS kind, b.id, a.start_at, a.end_at
         FROM service_bay b
         JOIN dealership d ON d.id = b.dealership_id AND d.tenant_id = $1
         LEFT JOIN appointment a ON a.service_bay_id = b.id AND a.status = 'CONFIRMED'
                                AND tstzrange(a.start_at, a.end_at, '[)') && tstzrange($4, $5, '[)')
        WHERE b.dealership_id = $2 AND b.active
          AND $6::text[] <@ ARRAY(SELECT c.capability_code FROM service_bay_capability c WHERE c.service_bay_id = b.id)
        ORDER BY 1, 2`,
      [
        ctx.tenantId,
        ctx.dealershipId,
        serviceType.requiredSkill,
        range.start.toJSDate(),
        range.end.toJSDate(),
        [...serviceType.requiredCapabilities],
      ],
    );
    const group = (kind: 'T' | 'B'): BusyResource[] => {
      const byId = new Map<string, Interval[]>();
      for (const r of rows.filter((x) => x.kind === kind)) {
        const list = byId.get(r.id) ?? [];
        if (r.start_at && r.end_at) list.push(interval(toDt(r.start_at), toDt(r.end_at)));
        byId.set(r.id, list);
      }
      return [...byId].map(([id, busy]) => ({ id, busy }));
    };
    return { technicians: group('T'), bays: group('B') };
  }
}
