import { ValidationError, ValidationPipe } from '@nestjs/common';
import { DomainError, FieldError } from '../../domain/errors';

function flatten(errors: ValidationError[], parent = ''): FieldError[] {
  return errors.flatMap((e) => {
    const field = parent ? `${parent}.${e.property}` : e.property;
    const own = Object.values(e.constraints ?? {}).map((message) => ({ field, message }));
    return [...own, ...flatten(e.children ?? [], field)];
  });
}

/**
 * Global validation (Constitution VI, research R4): 422, unknown properties rejected, and the
 * failure expressed as a DomainError so the problem+json filter formats it like any other error.
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    errorHttpStatusCode: 422,
    exceptionFactory: (errors) =>
      new DomainError('VALIDATION_FAILED', 'Request validation failed', {
        errors: flatten(errors),
      }),
  });
}
