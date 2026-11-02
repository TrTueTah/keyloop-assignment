import { randomUUID } from 'node:crypto';
import { IdGenerator } from '../../application/ports/id-generator';

export class UuidGenerator implements IdGenerator {
  next(): string {
    return randomUUID();
  }
}
