import { Counter, Histogram, metrics, SpanStatusCode, trace } from '@opentelemetry/api';
import { Logger } from 'pino';
import { Telemetry, TelemetryAttributes } from '../../application/ports/telemetry';
import { RequestContextStore } from '../../application/ports/request-context';

/** Attributes that are fine on spans/logs but explode metric cardinality (Constitution VII). */
export const FORBIDDEN_METRIC_ATTRIBUTES = [
  'tenant_id',
  'dealership_id',
  'tenantId',
  'dealershipId',
];

export class OtelTelemetry implements Telemetry {
  private readonly meter = metrics.getMeter('service-scheduler');
  private readonly tracer = trace.getTracer('service-scheduler');
  private readonly counters = new Map<string, Counter>();
  private readonly histograms = new Map<string, Histogram>();

  /**
   * @param strict throw on forbidden metric attributes (non-production) instead of dropping them.
   */
  constructor(
    private readonly strict: boolean,
    private readonly logger?: Logger,
    private readonly context?: RequestContextStore,
  ) {}

  count(name: string, attributes: TelemetryAttributes = {}, value = 1): void {
    const attrs = this.metricAttributes(name, attributes);
    let counter = this.counters.get(name);
    if (!counter) {
      counter = this.meter.createCounter(name);
      this.counters.set(name, counter);
    }
    counter.add(value, attrs);
  }

  observe(name: string, value: number, attributes: TelemetryAttributes = {}): void {
    const attrs = this.metricAttributes(name, attributes);
    let histogram = this.histograms.get(name);
    if (!histogram) {
      histogram = this.meter.createHistogram(name);
      this.histograms.set(name, histogram);
    }
    histogram.record(value, attrs);
  }

  async span<T>(
    name: string,
    attributes: TelemetryAttributes,
    fn: () => Promise<T> | T,
  ): Promise<T> {
    return this.tracer.startActiveSpan(
      name,
      { attributes: { ...this.tenantAttributes(), ...attributes } },
      async (span) => {
        try {
          return await fn();
        } catch (err) {
          span.recordException(err as Error);
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw err;
        } finally {
          span.end();
        }
      },
    );
  }

  log(
    level: 'info' | 'warn' | 'error',
    message: string,
    attributes: TelemetryAttributes = {},
  ): void {
    this.logger?.[level]({ ...this.tenantAttributes(), ...attributes }, message);
  }

  private tenantAttributes(): Record<string, string> {
    const ctx = this.context?.current();
    const out: Record<string, string> = {};
    if (ctx?.requestId) out.request_id = ctx.requestId;
    if (ctx?.tenant?.tenantId) out.tenant_id = ctx.tenant.tenantId;
    if (ctx?.tenant?.dealershipId) out.dealership_id = ctx.tenant.dealershipId;
    return out; // trace_id / span_id are injected into log lines by the OTel pino instrumentation
  }

  private metricAttributes(name: string, attributes: TelemetryAttributes): TelemetryAttributes {
    const bad = Object.keys(attributes).filter((k) => FORBIDDEN_METRIC_ATTRIBUTES.includes(k));
    if (bad.length === 0) return attributes;
    if (this.strict) {
      throw new Error(
        `Metric ${name} must not carry tenant attributes: ${bad.join(', ')} (Constitution VII)`,
      );
    }
    return Object.fromEntries(Object.entries(attributes).filter(([k]) => !bad.includes(k)));
  }
}
