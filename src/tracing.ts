/**
 * OpenTelemetry bootstrap (research R10). Loaded with `node --require` BEFORE Nest so that http,
 * express and pg are auto-instrumented. Part of the composition root.
 */
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';

let exporter: PrometheusExporter | undefined;
let sdk: NodeSDK | undefined;

export function startTelemetry(): void {
  if (sdk || process.env.OTEL_SDK_DISABLED === 'true') return;
  exporter = new PrometheusExporter({ preventServerStart: true });
  sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'service-scheduler',
    // OTEL_TRACES_EXPORTER=none keeps metrics but sends no spans (used by the observability e2e test).
    ...(process.env.OTEL_TRACES_EXPORTER === 'none'
      ? {}
      : { traceExporter: new OTLPTraceExporter() }),
    metricReaders: [exporter],
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });
  sdk.start();
  process.once('SIGTERM', () => {
    void sdk?.shutdown();
  });
}

/** Prometheus scrape handler, mounted at /metrics by main.ts (not a presentation controller). */
export function prometheusExporter(): PrometheusExporter | undefined {
  return exporter;
}

startTelemetry();
