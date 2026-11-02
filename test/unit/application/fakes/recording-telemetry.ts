// NOT evidence for DB guarantees (Constitution III): orchestration-only test double.
import { Telemetry, TelemetryAttributes } from '../../../../src/application/ports/telemetry';

export class RecordingTelemetry implements Telemetry {
  readonly counts: { name: string; attributes: TelemetryAttributes; value: number }[] = [];
  readonly observations: { name: string; value: number; attributes: TelemetryAttributes }[] = [];
  readonly spans: string[] = [];
  readonly logs: { level: string; message: string; attributes: TelemetryAttributes }[] = [];

  count(name: string, attributes: TelemetryAttributes = {}, value = 1): void {
    this.counts.push({ name, attributes, value });
  }
  observe(name: string, value: number, attributes: TelemetryAttributes = {}): void {
    this.observations.push({ name, value, attributes });
  }
  async span<T>(
    name: string,
    _attributes: TelemetryAttributes,
    fn: () => Promise<T> | T,
  ): Promise<T> {
    this.spans.push(name);
    return fn();
  }
  log(
    level: 'info' | 'warn' | 'error',
    message: string,
    attributes: TelemetryAttributes = {},
  ): void {
    this.logs.push({ level, message, attributes });
  }
  counted(name: string): TelemetryAttributes[] {
    return this.counts.filter((c) => c.name === name).map((c) => c.attributes);
  }
}
