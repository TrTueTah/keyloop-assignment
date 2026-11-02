import { EntityManager } from 'typeorm';
import {
  AppointmentPatch,
  AppointmentRepository,
  DayFilter,
  InsertOutcome,
  PageRequest,
  UpdateOutcome,
} from '../../../application/ports/appointment.repository';
import { IdempotencyStore } from '../../../application/ports/idempotency.store';
import { SiteContext, TenantContext } from '../../../application/tenant-context';
import { Interval } from '../../../domain/interval';
import { Appointment } from '../../../domain/model/appointment';
import { DateTime } from '../../../domain/time';
import { rowToDomain, toDomain, toOrm } from '../mappers/appointment.mapper';
import { AppointmentOrmEntity } from '../orm-entities';
import { toConflict } from '../pg-errors';
import { isUuid, queryRows } from './sql';

/** Every method is tenant- (and site-) scoped (Constitution II). */
export class TypeOrmAppointmentRepository implements AppointmentRepository, IdempotencyStore {
  constructor(
    private readonly em: EntityManager,
    private readonly onConflict: () => void = () => undefined,
  ) {}

  async insert(ctx: SiteContext, a: Appointment): Promise<InsertOutcome> {
    if (a.tenantId !== ctx.tenantId || a.dealershipId !== ctx.dealershipId) {
      throw new Error('Appointment scope does not match the tenant context');
    }
    try {
      await this.lockResources(a.technicianId, a.serviceBayId, a.vehicleId);
      await this.em.insert(AppointmentOrmEntity, toOrm(a));
      return { kind: 'inserted', appointment: a };
    } catch (err) {
      const conflict = toConflict(err);
      if (!conflict) throw err;
      this.onConflict();
      return conflict;
    }
  }

  /**
   * Deadlock avoidance, NOT the correctness guarantee (that stays with the exclusion constraints,
   * Constitution I). Concurrent inserts that conflict on several exclusion constraints can wait on
   * each other in a cycle (observed as 40P01 storms in the burst test, research R2). Locking the
   * resource rows first, always in the fixed order technician → bay → vehicle, makes contenders
   * queue instead; the next one then sees the committed winner and fails fast with 23P01.
   * FOR NO KEY UPDATE does not block other transactions' FK checks (FOR KEY SHARE).
   */
  private async lockResources(
    technicianId: string,
    serviceBayId: string,
    vehicleId?: string,
  ): Promise<void> {
    await this.em.query(`SELECT 1 FROM technician WHERE id = $1 FOR NO KEY UPDATE`, [technicianId]);
    await this.em.query(`SELECT 1 FROM service_bay WHERE id = $1 FOR NO KEY UPDATE`, [
      serviceBayId,
    ]);
    if (vehicleId)
      await this.em.query(`SELECT 1 FROM vehicle WHERE id = $1 FOR NO KEY UPDATE`, [vehicleId]);
  }

  async findById(ctx: SiteContext, id: string): Promise<Appointment | null> {
    if (!isUuid(id)) return null;
    const e = await this.em.findOne(AppointmentOrmEntity, {
      where: { id, tenantId: ctx.tenantId, dealershipId: ctx.dealershipId },
    });
    return e ? toDomain(e) : null;
  }

  async findByKey(ctx: TenantContext, key: string): Promise<Appointment | null> {
    const e = await this.em.findOne(AppointmentOrmEntity, {
      where: { tenantId: ctx.tenantId, idempotencyKey: key },
    });
    return e ? toDomain(e) : null;
  }

  async updateIfVersion(
    ctx: SiteContext,
    id: string,
    expectedVersion: number,
    patch: AppointmentPatch,
    now: DateTime,
  ): Promise<UpdateOutcome> {
    if (!isUuid(id)) return { kind: 'not_found' };
    const params: unknown[] = [id, ctx.tenantId, ctx.dealershipId, expectedVersion, now.toJSDate()];
    let set: string;
    if ('status' in patch) {
      set = `status = 'CANCELLED'`;
    } else {
      params.push(patch.technicianId, patch.serviceBayId);
      set = `technician_id = $6, service_bay_id = $7, assignment_mode = 'MANUAL'`;
    }
    let rows: Record<string, unknown>[];
    try {
      if (!('status' in patch)) await this.lockResources(patch.technicianId, patch.serviceBayId);
      // Explicit version check + affected-row count (Constitution V); never @VersionColumn.
      rows = await queryRows(
        this.em,
        `UPDATE appointment SET ${set}, version = version + 1, updated_at = $5
          WHERE id = $1 AND tenant_id = $2 AND dealership_id = $3 AND version = $4 AND status = 'CONFIRMED'
          RETURNING *`,
        params,
      );
    } catch (err) {
      const conflict = toConflict(err);
      if (!conflict || conflict.on === 'idempotency_key') throw err;
      this.onConflict();
      return { kind: 'conflict', on: conflict.on };
    }
    if (rows.length === 1) return { kind: 'updated', appointment: rowToDomain(rows[0]) };

    const current = await queryRows<{ status: string }>(
      this.em,
      `SELECT status FROM appointment WHERE id = $1 AND tenant_id = $2 AND dealership_id = $3`,
      [id, ctx.tenantId, ctx.dealershipId],
    );
    if (current.length === 0) return { kind: 'not_found' };
    if (current[0].status !== 'CONFIRMED') return { kind: 'not_confirmed' };
    return { kind: 'stale' };
  }

  async listForDay(
    ctx: SiteContext,
    range: Interval,
    filter: DayFilter,
    page: PageRequest,
  ): Promise<Appointment[]> {
    const params: unknown[] = [
      ctx.tenantId,
      ctx.dealershipId,
      range.start.toJSDate(),
      range.end.toJSDate(),
    ];
    const where = ['tenant_id = $1', 'dealership_id = $2', 'start_at >= $3', 'start_at < $4'];
    if (filter.status) {
      params.push(filter.status);
      where.push(`status = $${params.length}`);
    }
    if (filter.technicianId) {
      if (!isUuid(filter.technicianId)) return [];
      params.push(filter.technicianId);
      where.push(`technician_id = $${params.length}`);
    }
    if (page.after) {
      params.push(page.after.startAt.toJSDate(), page.after.id);
      where.push(`(start_at, id) > ($${params.length - 1}, $${params.length})`);
    }
    params.push(page.limit);
    const rows = await queryRows(
      this.em,
      `SELECT * FROM appointment WHERE ${where.join(' AND ')} ORDER BY start_at, id LIMIT $${params.length}`,
      params,
    );
    return rows.map(rowToDomain);
  }
}
