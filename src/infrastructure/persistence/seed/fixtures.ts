/**
 * Fixed seed dataset (data-model §6). Fixed UUIDs keep `quickstart.md`, `requests.http` and the
 * tests in sync. Two tenants exist so isolation can be demonstrated.
 */
const id = (prefix: string, n: number) => `${prefix}-0000-0000-0000-${String(n).padStart(12, '0')}`;

export const TENANT = {
  ACME: id('11111111', 1),
  BETA: id('11111111', 2),
} as const;

export const DEALERSHIP = {
  LEEDS: id('22222222', 1),
  YORK: id('22222222', 2),
  BETA_HQ: id('22222222', 3),
  /** Exactly 1 technician + 1 bay: deterministic concurrency tests and `pnpm demo:race`. */
  RACE: id('22222222', 4),
} as const;

export const SERVICE_TYPE = {
  OIL: id('33333333', 1),
  MAJOR: id('33333333', 2),
  ALIGNMENT: id('33333333', 3),
  EV_CHECK: id('33333333', 4),
  DIAGNOSTICS: id('33333333', 5),
  BETA_OIL: id('33333333', 6),
} as const;

export const CUSTOMER = {
  ALICE_SMITH: id('44444444', 1),
  BEN_JONES: id('44444444', 2),
  CHLOE_BROWN: id('44444444', 3),
  BETA_DAVID: id('44444444', 4),
} as const;

export const VEHICLE = {
  SMITH_GOLF: id('55555555', 1),
  JONES_LEAF: id('55555555', 2),
  BROWN_FIESTA: id('55555555', 3),
  BETA_CIVIC: id('55555555', 4),
} as const;

export const TECHNICIAN = {
  LEEDS_ALEX: id('66666666', 1), // GENERAL + EV
  LEEDS_BELLA: id('66666666', 2), // GENERAL
  LEEDS_CARL: id('66666666', 3), // GENERAL + DIAGNOSTICS
  LEEDS_DORA_INACTIVE: id('66666666', 4), // GENERAL, inactive
  YORK_ELI: id('66666666', 5),
  YORK_FAY: id('66666666', 6),
  BETA_GUS: id('66666666', 7),
  RACE_HAL: id('66666666', 8),
} as const;

export const BAY = {
  LEEDS_LIFT: id('77777777', 1), // LIFT
  LEEDS_ALIGN: id('77777777', 2), // LIFT + ALIGNMENT_RIG
  LEEDS_EV: id('77777777', 3), // LIFT + EV_CHARGER
  LEEDS_INACTIVE: id('77777777', 4), // LIFT, inactive
  YORK_1: id('77777777', 5),
  YORK_2: id('77777777', 6),
  BETA_1: id('77777777', 7),
  RACE_1: id('77777777', 8),
} as const;

export const SKILL = {
  ACME_GENERAL: id('88888888', 1),
  ACME_EV: id('88888888', 2),
  ACME_DIAGNOSTICS: id('88888888', 3),
  BETA_GENERAL: id('88888888', 4),
} as const;

export interface SeedData {
  tenants: { id: string; name: string }[];
  dealerships: { id: string; tenantId: string; name: string; timezone: string }[];
  openingHours: { dealershipId: string; weekday: number; opensAt: string; closesAt: string }[];
  skills: { id: string; tenantId: string; code: string; name: string }[];
  capabilities: { code: string; name: string }[];
  serviceTypes: {
    id: string;
    tenantId: string;
    code: string;
    name: string;
    durationMinutes: number;
    requiredSkillId: string;
    capabilities: string[];
  }[];
  technicians: {
    id: string;
    dealershipId: string;
    name: string;
    active: boolean;
    skillIds: string[];
  }[];
  bays: {
    id: string;
    dealershipId: string;
    name: string;
    active: boolean;
    capabilities: string[];
  }[];
  customers: { id: string; tenantId: string; name: string; email: string; phone: string }[];
  vehicles: {
    id: string;
    tenantId: string;
    customerId: string;
    vin: string;
    make: string;
    model: string;
    year: number;
  }[];
}

/** 20 extra Acme customers with one vehicle each: distinct vehicles for the race demo/tests. */
export const RACE_DRIVERS = Array.from({ length: 20 }, (_, i) => ({
  customerId: `44444444-0000-0000-0001-${String(i + 1).padStart(12, '0')}`,
  vehicleId: `55555555-0000-0000-0001-${String(i + 1).padStart(12, '0')}`,
  n: i + 1,
}));

const weekdays = (dealershipId: string, opensAt = '08:00', closesAt = '17:00') =>
  [1, 2, 3, 4, 5].map((weekday) => ({ dealershipId, weekday, opensAt, closesAt }));

export const SEED: SeedData = {
  tenants: [
    { id: TENANT.ACME, name: 'Acme Motor Group' },
    { id: TENANT.BETA, name: 'Beta Autos' },
  ],
  dealerships: [
    { id: DEALERSHIP.LEEDS, tenantId: TENANT.ACME, name: 'Acme Leeds', timezone: 'Europe/London' },
    { id: DEALERSHIP.YORK, tenantId: TENANT.ACME, name: 'Acme York', timezone: 'Europe/London' },
    {
      id: DEALERSHIP.BETA_HQ,
      tenantId: TENANT.BETA,
      name: 'Beta Autos HQ',
      timezone: 'Europe/London',
    },
    {
      id: DEALERSHIP.RACE,
      tenantId: TENANT.ACME,
      name: 'Acme Race Bay',
      timezone: 'Europe/London',
    },
  ],
  openingHours: [
    ...weekdays(DEALERSHIP.LEEDS),
    { dealershipId: DEALERSHIP.LEEDS, weekday: 6, opensAt: '09:00', closesAt: '13:00' },
    ...weekdays(DEALERSHIP.YORK),
    ...weekdays(DEALERSHIP.BETA_HQ),
    ...[1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
      dealershipId: DEALERSHIP.RACE,
      weekday,
      opensAt: '08:00',
      closesAt: '17:00',
    })),
  ],
  skills: [
    { id: SKILL.ACME_GENERAL, tenantId: TENANT.ACME, code: 'GENERAL', name: 'General servicing' },
    { id: SKILL.ACME_EV, tenantId: TENANT.ACME, code: 'EV_HIGH_VOLTAGE', name: 'EV high voltage' },
    { id: SKILL.ACME_DIAGNOSTICS, tenantId: TENANT.ACME, code: 'DIAGNOSTICS', name: 'Diagnostics' },
    { id: SKILL.BETA_GENERAL, tenantId: TENANT.BETA, code: 'GENERAL', name: 'General servicing' },
  ],
  capabilities: [
    { code: 'LIFT', name: 'Vehicle lift' },
    { code: 'ALIGNMENT_RIG', name: 'Wheel alignment rig' },
    { code: 'EV_CHARGER', name: 'EV charger' },
    { code: 'DIAGNOSTIC_RIG', name: 'Diagnostic rig' },
  ],
  serviceTypes: [
    {
      id: SERVICE_TYPE.OIL,
      tenantId: TENANT.ACME,
      code: 'OIL',
      name: 'Oil Change',
      durationMinutes: 30,
      requiredSkillId: SKILL.ACME_GENERAL,
      capabilities: ['LIFT'],
    },
    {
      id: SERVICE_TYPE.MAJOR,
      tenantId: TENANT.ACME,
      code: 'MAJOR',
      name: 'Major Service',
      durationMinutes: 180,
      requiredSkillId: SKILL.ACME_GENERAL,
      capabilities: ['LIFT'],
    },
    {
      id: SERVICE_TYPE.ALIGNMENT,
      tenantId: TENANT.ACME,
      code: 'ALIGN',
      name: 'Wheel Alignment',
      durationMinutes: 60,
      requiredSkillId: SKILL.ACME_GENERAL,
      capabilities: ['LIFT', 'ALIGNMENT_RIG'],
    },
    {
      id: SERVICE_TYPE.EV_CHECK,
      tenantId: TENANT.ACME,
      code: 'EV_CHECK',
      name: 'EV Battery Check',
      durationMinutes: 90,
      requiredSkillId: SKILL.ACME_EV,
      capabilities: ['LIFT', 'EV_CHARGER'],
    },
    {
      id: SERVICE_TYPE.DIAGNOSTICS,
      tenantId: TENANT.ACME,
      code: 'DIAG',
      name: 'Diagnostics',
      durationMinutes: 60,
      requiredSkillId: SKILL.ACME_DIAGNOSTICS,
      capabilities: [],
    },
    {
      id: SERVICE_TYPE.BETA_OIL,
      tenantId: TENANT.BETA,
      code: 'OIL',
      name: 'Oil Change',
      durationMinutes: 30,
      requiredSkillId: SKILL.BETA_GENERAL,
      capabilities: ['LIFT'],
    },
  ],
  technicians: [
    {
      id: TECHNICIAN.LEEDS_ALEX,
      dealershipId: DEALERSHIP.LEEDS,
      name: 'Alex',
      active: true,
      skillIds: [SKILL.ACME_GENERAL, SKILL.ACME_EV],
    },
    {
      id: TECHNICIAN.LEEDS_BELLA,
      dealershipId: DEALERSHIP.LEEDS,
      name: 'Bella',
      active: true,
      skillIds: [SKILL.ACME_GENERAL],
    },
    {
      id: TECHNICIAN.LEEDS_CARL,
      dealershipId: DEALERSHIP.LEEDS,
      name: 'Carl',
      active: true,
      skillIds: [SKILL.ACME_GENERAL, SKILL.ACME_DIAGNOSTICS],
    },
    {
      id: TECHNICIAN.LEEDS_DORA_INACTIVE,
      dealershipId: DEALERSHIP.LEEDS,
      name: 'Dora',
      active: false,
      skillIds: [SKILL.ACME_GENERAL],
    },
    {
      id: TECHNICIAN.YORK_ELI,
      dealershipId: DEALERSHIP.YORK,
      name: 'Eli',
      active: true,
      skillIds: [SKILL.ACME_GENERAL],
    },
    {
      id: TECHNICIAN.YORK_FAY,
      dealershipId: DEALERSHIP.YORK,
      name: 'Fay',
      active: true,
      skillIds: [SKILL.ACME_GENERAL, SKILL.ACME_EV],
    },
    {
      id: TECHNICIAN.BETA_GUS,
      dealershipId: DEALERSHIP.BETA_HQ,
      name: 'Gus',
      active: true,
      skillIds: [SKILL.BETA_GENERAL],
    },
    {
      id: TECHNICIAN.RACE_HAL,
      dealershipId: DEALERSHIP.RACE,
      name: 'Hal',
      active: true,
      skillIds: [SKILL.ACME_GENERAL],
    },
  ],
  bays: [
    {
      id: BAY.LEEDS_LIFT,
      dealershipId: DEALERSHIP.LEEDS,
      name: 'Leeds Bay 1 (lift)',
      active: true,
      capabilities: ['LIFT'],
    },
    {
      id: BAY.LEEDS_ALIGN,
      dealershipId: DEALERSHIP.LEEDS,
      name: 'Leeds Bay 2 (alignment)',
      active: true,
      capabilities: ['LIFT', 'ALIGNMENT_RIG'],
    },
    {
      id: BAY.LEEDS_EV,
      dealershipId: DEALERSHIP.LEEDS,
      name: 'Leeds Bay 3 (EV)',
      active: true,
      capabilities: ['LIFT', 'EV_CHARGER'],
    },
    {
      id: BAY.LEEDS_INACTIVE,
      dealershipId: DEALERSHIP.LEEDS,
      name: 'Leeds Bay 4 (closed)',
      active: false,
      capabilities: ['LIFT'],
    },
    {
      id: BAY.YORK_1,
      dealershipId: DEALERSHIP.YORK,
      name: 'York Bay 1',
      active: true,
      capabilities: ['LIFT'],
    },
    {
      id: BAY.YORK_2,
      dealershipId: DEALERSHIP.YORK,
      name: 'York Bay 2',
      active: true,
      capabilities: ['LIFT', 'EV_CHARGER'],
    },
    {
      id: BAY.BETA_1,
      dealershipId: DEALERSHIP.BETA_HQ,
      name: 'Beta Bay 1',
      active: true,
      capabilities: ['LIFT'],
    },
    {
      id: BAY.RACE_1,
      dealershipId: DEALERSHIP.RACE,
      name: 'Race Bay',
      active: true,
      capabilities: ['LIFT'],
    },
  ],
  customers: [
    {
      id: CUSTOMER.ALICE_SMITH,
      tenantId: TENANT.ACME,
      name: 'Alice Smith',
      email: 'alice.smith@example.test',
      phone: '+44 7700 900001',
    },
    {
      id: CUSTOMER.BEN_JONES,
      tenantId: TENANT.ACME,
      name: 'Ben Jones',
      email: 'ben.jones@example.test',
      phone: '+44 7700 900002',
    },
    {
      id: CUSTOMER.CHLOE_BROWN,
      tenantId: TENANT.ACME,
      name: 'Chloe Brown',
      email: 'chloe.brown@example.test',
      phone: '+44 7700 900003',
    },
    {
      id: CUSTOMER.BETA_DAVID,
      tenantId: TENANT.BETA,
      name: 'David Beta',
      email: 'david@beta.example.test',
      phone: '+44 7700 900004',
    },
    ...RACE_DRIVERS.map((d) => ({
      id: d.customerId,
      tenantId: TENANT.ACME,
      name: `Race Customer ${d.n}`,
      email: `race${d.n}@example.test`,
      phone: `+44 7700 91${String(d.n).padStart(4, '0')}`,
    })),
  ],
  vehicles: [
    {
      id: VEHICLE.SMITH_GOLF,
      tenantId: TENANT.ACME,
      customerId: CUSTOMER.ALICE_SMITH,
      vin: 'WVWZZZ1KZAW000001',
      make: 'Volkswagen',
      model: 'Golf',
      year: 2021,
    },
    {
      id: VEHICLE.JONES_LEAF,
      tenantId: TENANT.ACME,
      customerId: CUSTOMER.BEN_JONES,
      vin: 'SJNFAAZE1U0000002',
      make: 'Nissan',
      model: 'Leaf',
      year: 2022,
    },
    {
      id: VEHICLE.BROWN_FIESTA,
      tenantId: TENANT.ACME,
      customerId: CUSTOMER.CHLOE_BROWN,
      vin: 'WF0DXXGAKDA000003',
      make: 'Ford',
      model: 'Fiesta',
      year: 2019,
    },
    {
      id: VEHICLE.BETA_CIVIC,
      tenantId: TENANT.BETA,
      customerId: CUSTOMER.BETA_DAVID,
      vin: 'SHHFK7H50JU000004',
      make: 'Honda',
      model: 'Civic',
      year: 2020,
    },
    ...RACE_DRIVERS.map((d) => ({
      id: d.vehicleId,
      tenantId: TENANT.ACME,
      customerId: d.customerId,
      vin: `RACE${String(d.n).padStart(13, '0')}`,
      make: 'Test',
      model: 'Car',
      year: 2024,
    })),
  ],
};
