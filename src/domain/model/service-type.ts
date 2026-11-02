export interface ServiceType {
  readonly id: string;
  readonly tenantId: string;
  readonly code: string;
  readonly name: string;
  /** Fixed duration; clients never supply it (FR-002). */
  readonly durationMinutes: number;
  /** Skill code a technician must hold (Q1). */
  readonly requiredSkill: string;
  /** Capability codes a bay must have, all of them (Q2). */
  readonly requiredCapabilities: readonly string[];
}
