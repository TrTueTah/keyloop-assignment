import { ArgumentsHost, BadRequestException, NotFoundException } from '@nestjs/common';
import {
  ProblemFilter,
  STATUS_BY_CODE,
} from '../../../src/presentation/http/problem/problem.filter';
import { DomainError, ERROR_CODES } from '../../../src/domain/errors';
import { RecordingTelemetry } from '../application/fakes/recording-telemetry';

function run(exception: unknown) {
  const sent: { status?: number; type?: string; body?: Record<string, unknown> } = {};
  const res = {
    status(s: number) {
      sent.status = s;
      return res;
    },
    type(t: string) {
      sent.type = t;
      return res;
    },
    send(b: string) {
      sent.body = JSON.parse(b);
      return res;
    },
    json(b: Record<string, unknown>) {
      sent.body = b;
      return res;
    },
  };
  const host = {
    switchToHttp: () => ({ getRequest: () => ({ originalUrl: '/x' }), getResponse: () => res }),
  } as unknown as ArgumentsHost;
  const telemetry = new RecordingTelemetry();
  new ProblemFilter(
    { current: () => ({ requestId: 'rid-1' }), run: (_c, f) => f(), setTenant: () => undefined },
    telemetry,
  ).catch(exception, host);
  return { sent, telemetry };
}

describe('ProblemFilter (RFC 9457)', () => {
  it('maps every catalogue code to a status', () => {
    for (const code of ERROR_CODES) expect(STATUS_BY_CODE[code]).toBeGreaterThanOrEqual(400);
  });

  it.each([
    ['NOT_FOUND', 404],
    ['SLOT_UNAVAILABLE', 409],
    ['RESOURCE_UNAVAILABLE', 409],
    ['VEHICLE_ALREADY_BOOKED', 409],
    ['STALE_VERSION', 409],
    ['NOT_CONFIRMED', 409],
    ['VALIDATION_FAILED', 422],
    ['NOT_ON_SLOT_GRID', 422],
    ['IDEMPOTENCY_KEY_REUSED', 422],
  ] as const)('%s → %i problem+json', (code, status) => {
    const { sent } = run(new DomainError(code, 'd'));
    expect(sent.status).toBe(status);
    expect(sent.type).toBe('application/problem+json');
    expect(sent.body).toMatchObject({
      status,
      code,
      detail: 'd',
      instance: '/x',
      requestId: 'rid-1',
    });
    expect(sent.body?.type).toMatch(/^https:\/\/errors\./);
  });

  it('carries alternatives / field errors from meta', () => {
    const alternatives = [{ startAt: 'a', endAt: 'b', availableTechnicians: 1, availableBays: 1 }];
    expect(
      run(new DomainError('SLOT_UNAVAILABLE', undefined, { alternatives })).sent.body?.alternatives,
    ).toEqual(alternatives);
  });

  it('maps framework 404 / 400 to NOT_FOUND / VALIDATION_FAILED', () => {
    expect(run(new NotFoundException()).sent.body?.code).toBe('NOT_FOUND');
    const bad = run(new BadRequestException('Unexpected token in JSON'));
    expect(bad.sent.status).toBe(422);
    expect(bad.sent.body?.code).toBe('VALIDATION_FAILED');
  });

  it('never leaks unknown error messages to the client, but logs them', () => {
    const { sent, telemetry } = run(new Error('secret alice.smith@example.test'));
    expect(sent.status).toBe(500);
    expect(JSON.stringify(sent.body)).not.toContain('alice');
    expect(telemetry.logs[0].level).toBe('error');
  });
});
