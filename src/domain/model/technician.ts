export interface Technician {
  readonly id: string;
  readonly dealershipId: string;
  readonly name: string;
  readonly active: boolean;
  readonly skills: readonly string[];
}
