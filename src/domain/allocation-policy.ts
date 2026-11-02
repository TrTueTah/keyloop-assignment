/** A free, qualified/compatible resource considered for auto-assignment. */
export interface ResourceCandidate {
  readonly id: string;
  /** Confirmed booked minutes on the dealership-local day (A11). */
  readonly bookedMinutes: number;
  /** Number of capabilities (bays) or skills (technicians); fewer = less specialised. */
  readonly capabilityCount: number;
}

/** Strategy for choosing among free resources (Constitution IV: must sit behind this interface). */
export interface AllocationPolicy {
  rank(candidates: readonly ResourceCandidate[]): ResourceCandidate[];
}

/** Default A11 policy: least booked minutes, then fewer capabilities, then id (deterministic). */
export class LeastLoadedPolicy implements AllocationPolicy {
  rank(candidates: readonly ResourceCandidate[]): ResourceCandidate[] {
    return [...candidates].sort(
      (a, b) =>
        a.bookedMinutes - b.bookedMinutes ||
        a.capabilityCount - b.capabilityCount ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  }
}
