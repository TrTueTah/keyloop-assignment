import { AppointmentEventOrmEntity } from './appointment-event.orm-entity';
import { AppointmentOrmEntity } from './appointment.orm-entity';

/**
 * Only the transactional tables are mapped. Reference data is read with aggregated, tenant-scoped
 * SQL (skills/capabilities arrays), so per-table reference entities would be unused code
 * (Constitution VIII: simplest design that keeps I–VII).
 */
export const ORM_ENTITIES = [AppointmentOrmEntity, AppointmentEventOrmEntity];

export { AppointmentEventOrmEntity, AppointmentOrmEntity };
