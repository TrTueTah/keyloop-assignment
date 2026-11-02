export type TelemetryAttributes = Readonly<Record<string, string | number | boolean>>;

/**
 * Business metrics and spans. Metric attributes MUST NOT include tenant_id / dealership_id
 * (Constitution VII); span attributes may.
 */
export interface Telemetry {
  count(name: string, attributes?: TelemetryAttributes, value?: number): void;
  observe(name: string, value: number, attributes?: TelemetryAttributes): void;
  span<T>(name: string, attributes: TelemetryAttributes, fn: () => Promise<T> | T): Promise<T>;
  /**
   * Structured business log line (e.g. booking outcome, attempt, constraint). The adapter adds
   * request_id / trace_id / tenant_id / dealership_id. Attributes MUST NOT contain PII.
   */
  log(level: 'info' | 'warn' | 'error', message: string, attributes?: TelemetryAttributes): void;
}
export const TELEMETRY = Symbol('TELEMETRY');
