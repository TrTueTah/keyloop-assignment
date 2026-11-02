import { ResourceCandidate } from '../../domain/allocation-policy';
import { ResourceSchedule } from '../../domain/availability-calculator';
import { Interval } from '../../domain/interval';
import { ServiceBay } from '../../domain/model/service-bay';
import { ServiceType } from '../../domain/model/service-type';
import { Technician } from '../../domain/model/technician';
import { SiteContext, TenantContext } from '../tenant-context';

export interface CandidateQuery {
  readonly serviceType: ServiceType;
  readonly slot: Interval;
  /** Dealership-local day used for the least-loaded calculation (A11). */
  readonly localDay: Interval;
  readonly excludeTechnicianIds: readonly string[];
  readonly excludeBayIds: readonly string[];
  /** When set, only this resource is considered (manual pin, FR-014). */
  readonly pinnedTechnicianId?: string;
  readonly pinnedBayId?: string;
}

export interface Candidates {
  readonly technicians: ResourceCandidate[];
  readonly bays: ResourceCandidate[];
}

/** A resource with its CONFIRMED busy intervals (the domain's ResourceSchedule). */
export type BusyResource = ResourceSchedule;

/** Qualified technicians and compatible bays with their CONFIRMED busy intervals over a range. */
export interface AvailabilitySnapshot {
  readonly technicians: readonly BusyResource[];
  readonly bays: readonly BusyResource[];
}

export interface ResourceQuery {
  /** Active, qualified/compatible resources at the site that are FREE for `slot` (advisory; R6). */
  findCandidates(ctx: SiteContext, query: CandidateQuery): Promise<Candidates>;
  /** Tenant-scoped lookups (any site of the tenant), so callers can report RESOURCE_NOT_IN_DEALERSHIP. */
  getTechnician(ctx: TenantContext, id: string): Promise<Technician | null>;
  getBay(ctx: TenantContext, id: string): Promise<ServiceBay | null>;
  /** Fixed number of queries regardless of range length or slot count (Constitution VIII). */
  availabilitySnapshot(
    ctx: SiteContext,
    serviceType: ServiceType,
    range: Interval,
  ): Promise<AvailabilitySnapshot>;
}
export const RESOURCE_QUERY = Symbol('RESOURCE_QUERY');
