import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { RequestContextStore } from '../../../application/ports/request-context';
import { Telemetry } from '../../../application/ports/telemetry';
import { DomainError, DomainErrorMeta, ErrorCode } from '../../../domain/errors';

/** HTTP status per error code. Lives only in presentation (Constitution IV). */
export const STATUS_BY_CODE: Readonly<Record<ErrorCode, number>> = {
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  START_IN_PAST: 422,
  NOT_ON_SLOT_GRID: 422,
  OUTSIDE_BOOKING_HORIZON: 422,
  OUTSIDE_OPENING_HOURS: 422,
  VEHICLE_NOT_OWNED_BY_CUSTOMER: 422,
  TECHNICIAN_NOT_QUALIFIED: 422,
  BAY_NOT_COMPATIBLE: 422,
  RESOURCE_INACTIVE: 422,
  RESOURCE_NOT_IN_DEALERSHIP: 422,
  IDEMPOTENCY_KEY_REUSED: 422,
  SLOT_UNAVAILABLE: 409,
  RESOURCE_UNAVAILABLE: 409,
  VEHICLE_ALREADY_BOOKED: 409,
  STALE_VERSION: 409,
  NOT_CONFIRMED: 409,
  INTERNAL_ERROR: 500,
};

const TITLES: Readonly<Record<ErrorCode, string>> = {
  NOT_FOUND: 'Resource not found',
  VALIDATION_FAILED: 'Request validation failed',
  START_IN_PAST: 'Start time is in the past',
  NOT_ON_SLOT_GRID: 'Start time is not on the 15-minute grid',
  OUTSIDE_BOOKING_HORIZON: 'Start time is beyond the booking horizon',
  OUTSIDE_OPENING_HOURS: 'Appointment does not fit within opening hours',
  VEHICLE_NOT_OWNED_BY_CUSTOMER: 'Vehicle does not belong to the customer',
  TECHNICIAN_NOT_QUALIFIED: 'Technician is not qualified for this service',
  BAY_NOT_COMPATIBLE: 'Service bay lacks required equipment',
  RESOURCE_INACTIVE: 'Resource is inactive',
  RESOURCE_NOT_IN_DEALERSHIP: 'Resource does not belong to this dealership',
  IDEMPOTENCY_KEY_REUSED: 'Idempotency key reused with a different request',
  SLOT_UNAVAILABLE: 'Requested time is unavailable',
  RESOURCE_UNAVAILABLE: 'Requested resource is unavailable',
  VEHICLE_ALREADY_BOOKED: 'Vehicle already has an appointment at that time',
  STALE_VERSION: 'Appointment was changed by someone else',
  NOT_CONFIRMED: 'Appointment is no longer confirmed',
  INTERNAL_ERROR: 'Internal server error',
};

export interface ProblemBody extends DomainErrorMeta {
  type: string;
  title: string;
  status: number;
  code: ErrorCode;
  detail?: string;
  instance?: string;
  requestId?: string;
}

/**
 * RFC 9457 problem+json for every error (Constitution VI). Bodies never contain customer PII:
 * details are generic or ID-based, and unknown errors never echo their message or stack.
 */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  constructor(
    private readonly context: RequestContextStore,
    private readonly telemetry: Telemetry,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    if (
      exception instanceof HttpException &&
      exception.getStatus() === HttpStatus.SERVICE_UNAVAILABLE
    ) {
      // Readiness (terminus) reports its own body.
      res.status(503).json(exception.getResponse());
      return;
    }

    const error = this.toDomainError(exception);
    if (error.code === 'INTERNAL_ERROR') {
      this.telemetry.log('error', 'unhandled error', {
        error_name: exception instanceof Error ? exception.name : typeof exception,
        error_message: exception instanceof Error ? exception.message : 'non-error thrown',
      });
    }
    const status = STATUS_BY_CODE[error.code];
    const body: ProblemBody = {
      type: `https://errors.service-scheduler.local/${error.code.toLowerCase().replace(/_/g, '-')}`,
      title: TITLES[error.code],
      status,
      code: error.code,
      ...(error.detail ? { detail: error.detail } : {}),
      instance: req.originalUrl,
      requestId: this.context.current()?.requestId,
      ...error.meta,
    };
    res.status(status).type('application/problem+json').send(JSON.stringify(body));
  }

  private toDomainError(exception: unknown): DomainError {
    if (exception instanceof DomainError) return exception;
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status === 404) return new DomainError('NOT_FOUND', 'Route not found');
      if (status >= 400 && status < 500)
        return new DomainError('VALIDATION_FAILED', 'Malformed request');
    }
    return new DomainError('INTERNAL_ERROR', 'An unexpected error occurred');
  }
}
