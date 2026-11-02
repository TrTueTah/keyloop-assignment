import {
  checkPinnedBay,
  checkPinnedTechnician,
  isCompatible,
  isQualified,
} from '../../../src/domain/qualification';
import { ServiceType } from '../../../src/domain/model/service-type';
import { Technician } from '../../../src/domain/model/technician';
import { ServiceBay } from '../../../src/domain/model/service-bay';

const SITE = 'site-1';
const evCheck: ServiceType = {
  id: 'st-ev',
  tenantId: 't',
  code: 'EV',
  name: 'EV Battery Check',
  durationMinutes: 90,
  requiredSkill: 'EV_HIGH_VOLTAGE',
  requiredCapabilities: ['LIFT', 'EV_CHARGER'],
};
const diagnostics: ServiceType = {
  ...evCheck,
  id: 'st-d',
  requiredSkill: 'DIAGNOSTICS',
  requiredCapabilities: [],
};
const tech = (skills: string[], active = true, dealershipId = SITE): Technician => ({
  id: 'tech',
  dealershipId,
  name: 'x',
  active,
  skills,
});
const bay = (capabilities: string[], active = true, dealershipId = SITE): ServiceBay => ({
  id: 'bay',
  dealershipId,
  name: 'x',
  active,
  capabilities,
});

describe('qualification', () => {
  it('technician is qualified iff active and holds the required skill', () => {
    expect(isQualified(tech(['GENERAL', 'EV_HIGH_VOLTAGE']), evCheck)).toBe(true);
    expect(isQualified(tech(['GENERAL']), evCheck)).toBe(false);
    expect(isQualified(tech(['EV_HIGH_VOLTAGE'], false), evCheck)).toBe(false);
  });

  it('bay is compatible iff active and has ALL required capabilities', () => {
    expect(isCompatible(bay(['LIFT', 'EV_CHARGER']), evCheck)).toBe(true);
    expect(isCompatible(bay(['LIFT']), evCheck)).toBe(false);
    expect(isCompatible(bay(['LIFT', 'EV_CHARGER'], false), evCheck)).toBe(false);
  });

  it('a service with no required capabilities fits any active bay', () => {
    expect(isCompatible(bay([]), diagnostics)).toBe(true);
    expect(isCompatible(bay([], false), diagnostics)).toBe(false);
  });

  it('pinned technician checks return the specific error code', () => {
    expect(checkPinnedTechnician(tech(['EV_HIGH_VOLTAGE']), evCheck, SITE)).toBeNull();
    expect(checkPinnedTechnician(tech(['EV_HIGH_VOLTAGE'], true, 'other'), evCheck, SITE)).toBe(
      'RESOURCE_NOT_IN_DEALERSHIP',
    );
    expect(checkPinnedTechnician(tech(['EV_HIGH_VOLTAGE'], false), evCheck, SITE)).toBe(
      'RESOURCE_INACTIVE',
    );
    expect(checkPinnedTechnician(tech(['GENERAL']), evCheck, SITE)).toBe(
      'TECHNICIAN_NOT_QUALIFIED',
    );
  });

  it('pinned bay checks return the specific error code', () => {
    expect(checkPinnedBay(bay(['LIFT', 'EV_CHARGER']), evCheck, SITE)).toBeNull();
    expect(checkPinnedBay(bay(['LIFT', 'EV_CHARGER'], true, 'other'), evCheck, SITE)).toBe(
      'RESOURCE_NOT_IN_DEALERSHIP',
    );
    expect(checkPinnedBay(bay(['LIFT', 'EV_CHARGER'], false), evCheck, SITE)).toBe(
      'RESOURCE_INACTIVE',
    );
    expect(checkPinnedBay(bay(['LIFT']), evCheck, SITE)).toBe('BAY_NOT_COMPATIBLE');
  });
});
