/** ISO weekday (1 = Monday … 7 = Sunday) with local opening/closing time "HH:mm". */
export interface OpeningHours {
  readonly weekday: number;
  readonly opensAt: string;
  readonly closesAt: string;
}

export interface Dealership {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  /** IANA time zone, e.g. Europe/London. */
  readonly timezone: string;
  readonly openingHours: readonly OpeningHours[];
}
