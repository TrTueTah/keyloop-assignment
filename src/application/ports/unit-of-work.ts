import { AppointmentEventRepository } from './appointment-event.repository';
import { AppointmentRepository } from './appointment.repository';
import { ResourceQuery } from './resource.query';

/** Repositories bound to one database transaction. No ORM types cross this port (Constitution IV). */
export interface TxScope {
  readonly appointments: AppointmentRepository;
  readonly events: AppointmentEventRepository;
  readonly resources: ResourceQuery;
}

/**
 * The use case owns the transaction boundary; only the adapter knows how one is opened.
 * If any write inside `work` reports a conflict, the adapter rolls the transaction back and still
 * returns `work`'s result (research R6). Each call is a fresh transaction.
 */
export interface UnitOfWork {
  run<T>(work: (tx: TxScope) => Promise<T>): Promise<T>;
}
export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');
