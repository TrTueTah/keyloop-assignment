import { ErrorCode } from './errors';
import { ServiceBay } from './model/service-bay';
import { ServiceType } from './model/service-type';
import { Technician } from './model/technician';

/** Q1: a technician is qualified iff active and holding the service type's required skill. */
export function isQualified(tech: Technician, serviceType: ServiceType): boolean {
  return tech.active && tech.skills.includes(serviceType.requiredSkill);
}

/** Q2: a bay is compatible iff active and having ALL required capabilities. */
export function isCompatible(bay: ServiceBay, serviceType: ServiceType): boolean {
  return bay.active && serviceType.requiredCapabilities.every((c) => bay.capabilities.includes(c));
}

/** Checks for a manually chosen technician (FR-016); returns the specific error code or null. */
export function checkPinnedTechnician(
  tech: Technician,
  serviceType: ServiceType,
  dealershipId: string,
): ErrorCode | null {
  if (tech.dealershipId !== dealershipId) return 'RESOURCE_NOT_IN_DEALERSHIP';
  if (!tech.active) return 'RESOURCE_INACTIVE';
  if (!tech.skills.includes(serviceType.requiredSkill)) return 'TECHNICIAN_NOT_QUALIFIED';
  return null;
}

/** Checks for a manually chosen bay (FR-016); returns the specific error code or null. */
export function checkPinnedBay(
  bay: ServiceBay,
  serviceType: ServiceType,
  dealershipId: string,
): ErrorCode | null {
  if (bay.dealershipId !== dealershipId) return 'RESOURCE_NOT_IN_DEALERSHIP';
  if (!bay.active) return 'RESOURCE_INACTIVE';
  if (!serviceType.requiredCapabilities.every((c) => bay.capabilities.includes(c))) {
    return 'BAY_NOT_COMPATIBLE';
  }
  return null;
}
