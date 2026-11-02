import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { DomainError } from '../../../domain/errors';

const KEY = /^[\x21-\x7E]{1,255}$/;

/**
 * Reads and validates the Idempotency-Key header (FR-010). Presence/format only: the replay rule is
 * business logic and lives in the BookAppointment use case (research R8, Constitution IV).
 */
export const IdempotencyKey = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const key = ctx.switchToHttp().getRequest<Request>().header('idempotency-key');
  if (!key || !KEY.test(key)) {
    throw new DomainError('VALIDATION_FAILED', 'Idempotency-Key header is required', {
      errors: [{ field: 'Idempotency-Key', message: 'required, 1-255 printable ASCII characters' }],
    });
  }
  return key;
});
