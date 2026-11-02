import { EntityManager } from 'typeorm';
import { AppointmentEventRepository } from '../../../application/ports/appointment-event.repository';
import { SiteContext, TenantContext } from '../../../application/tenant-context';
import { AppointmentEvent } from '../../../domain/model/appointment';
import { eventToDomain, eventToOrm } from '../mappers/appointment.mapper';
import { AppointmentEventOrmEntity } from '../orm-entities';
import { isUuid, queryRows } from './sql';

export class TypeOrmAppointmentEventRepository implements AppointmentEventRepository {
  constructor(private readonly em: EntityManager) {}

  async append(ctx: TenantContext, event: AppointmentEvent): Promise<void> {
    if (event.tenantId !== ctx.tenantId)
      throw new Error('Event scope does not match the tenant context');
    await this.em.insert(AppointmentEventOrmEntity, eventToOrm(event));
  }

  async listForAppointment(ctx: SiteContext, appointmentId: string): Promise<AppointmentEvent[]> {
    if (!isUuid(appointmentId)) return [];
    const rows = await queryRows<Record<string, unknown>>(
      this.em,
      `SELECT e.* FROM appointment_event e
         JOIN appointment a ON a.id = e.appointment_id
        WHERE e.appointment_id = $1 AND e.tenant_id = $2 AND a.dealership_id = $3
        ORDER BY e.occurred_at, e.id`,
      [appointmentId, ctx.tenantId, ctx.dealershipId],
    );
    return rows.map((r) => {
      const e = new AppointmentEventOrmEntity();
      Object.assign(e, {
        id: r.id,
        tenantId: r.tenant_id,
        appointmentId: r.appointment_id,
        type: r.type,
        actor: r.actor,
        payload: r.payload,
        occurredAt: r.occurred_at,
        publishedAt: r.published_at,
      });
      return eventToDomain(e);
    });
  }
}
