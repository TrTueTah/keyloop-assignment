// NOT evidence for DB guarantees (Constitution III): orchestration-only test double.
import { IdGenerator } from '../../../../src/application/ports/id-generator';

export class SequentialIdGenerator implements IdGenerator {
  private n = 0;
  next(): string {
    this.n += 1;
    return `00000000-0000-4000-8000-${String(this.n).padStart(12, '0')}`;
  }
}
