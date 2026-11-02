import { OtelTelemetry } from '../../../src/infrastructure/observability/otel-telemetry';

describe('OtelTelemetry (Constitution VII: no tenant labels on metrics)', () => {
  it('throws in strict mode when a metric carries tenant_id or dealership_id', () => {
    const t = new OtelTelemetry(true);
    expect(() => t.count('bookings_total', { tenant_id: 'x' })).toThrow(/tenant attributes/);
    expect(() => t.observe('booking_duration_seconds', 1, { dealership_id: 'x' })).toThrow(
      /tenant attributes/,
    );
  });

  it('drops forbidden attributes instead of throwing in non-strict (production) mode', () => {
    const t = new OtelTelemetry(false);
    expect(() => t.count('bookings_total', { tenant_id: 'x', outcome: 'confirmed' })).not.toThrow();
  });

  it('allows low-cardinality attributes and runs spans', async () => {
    const t = new OtelTelemetry(true);
    expect(() =>
      t.count('bookings_total', { outcome: 'confirmed', channel: 'ADVISOR' }),
    ).not.toThrow();
    await expect(t.span('allocate', { tenant_id: 'ok-on-spans' }, async () => 42)).resolves.toBe(
      42,
    );
  });

  it('propagates errors thrown inside a span', async () => {
    const t = new OtelTelemetry(true);
    await expect(t.span('x', {}, async () => Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom',
    );
  });
});
