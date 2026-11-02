import { DataSource } from 'typeorm';
import { TxScope, UnitOfWork } from '../../application/ports/unit-of-work';
import { TypeOrmAppointmentEventRepository } from './repositories/typeorm-appointment-event.repository';
import { TypeOrmAppointmentRepository } from './repositories/typeorm-appointment.repository';
import { TypeOrmResourceQuery } from './repositories/typeorm-resource.query';

class RollbackSentinel<T> {
  constructor(readonly result: T) {}
}

/**
 * READ COMMITTED is sufficient: the exclusion constraints, not isolation, provide correctness
 * (Constitution I, research R6). When a write inside `work` reports a conflict the transaction is
 * aborted by PostgreSQL anyway; we roll back explicitly and hand the typed outcome back.
 */
export class TypeOrmUnitOfWork implements UnitOfWork {
  constructor(private readonly ds: DataSource) {}

  async run<T>(work: (tx: TxScope) => Promise<T>): Promise<T> {
    try {
      return await this.ds.transaction('READ COMMITTED', async (em) => {
        let conflicted = false;
        const scope: TxScope = {
          appointments: new TypeOrmAppointmentRepository(em, () => {
            conflicted = true;
          }),
          events: new TypeOrmAppointmentEventRepository(em),
          resources: new TypeOrmResourceQuery(em),
        };
        const result = await work(scope);
        if (conflicted) throw new RollbackSentinel(result);
        return result;
      });
    } catch (err) {
      if (err instanceof RollbackSentinel) return err.result as T;
      throw err;
    }
  }
}
