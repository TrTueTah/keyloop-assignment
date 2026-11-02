import { AppointmentEvent } from '../../domain/model/appointment';
import { SiteContext, TenantContext } from '../tenant-context';

export interface AppointmentEventRepository {
  append(ctx: TenantContext, event: AppointmentEvent): Promise<void>;
  listForAppointment(ctx: SiteContext, appointmentId: string): Promise<AppointmentEvent[]>;
}
export const APPOINTMENT_EVENT_REPOSITORY = Symbol('APPOINTMENT_EVENT_REPOSITORY');
