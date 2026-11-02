export interface HealthStatus {
  readonly db: boolean;
  readonly migrations: boolean;
}

export interface HealthProbe {
  check(): Promise<HealthStatus>;
}
export const HEALTH_PROBE = Symbol('HEALTH_PROBE');
