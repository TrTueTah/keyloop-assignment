import {
  DEALERSHIP,
  SERVICE_TYPE,
  TECHNICIAN,
  BAY,
} from '../../src/infrastructure/persistence/seed/fixtures';
import { asAcme, asBeta, createTestApp, TestApp } from '../setup/app';

describe('US4: reference data for manual choices (FR-022)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ logLevel: 'warn' });
  });
  afterAll(() => t.close());

  it('dealerships and service types are scoped to the caller’s tenant', async () => {
    const acme = (await t.http.get('/api/v1/dealerships').set(asAcme()).expect(200)).body;
    expect(acme.map((d: { id: string }) => d.id).sort()).toEqual(
      [DEALERSHIP.LEEDS, DEALERSHIP.YORK, DEALERSHIP.RACE].sort(),
    );
    const beta = (await t.http.get('/api/v1/dealerships').set(asBeta()).expect(200)).body;
    expect(beta).toEqual([
      { id: DEALERSHIP.BETA_HQ, name: 'Beta Autos HQ', timezone: 'Europe/London' },
    ]);

    const types = (await t.http.get('/api/v1/service-types').set(asAcme()).expect(200)).body;
    expect(types.find((s: { id: string }) => s.id === SERVICE_TYPE.EV_CHECK)).toEqual({
      id: SERVICE_TYPE.EV_CHECK,
      code: 'EV_CHECK',
      name: 'EV Battery Check',
      durationMinutes: 90,
      requiredSkill: 'EV_HIGH_VOLTAGE',
      requiredCapabilities: ['EV_CHARGER', 'LIFT'],
    });
    expect(types.map((s: { id: string }) => s.id)).not.toContain(SERVICE_TYPE.BETA_OIL);
  });

  it('technicians (with skills) and bays (with capabilities) at a site', async () => {
    const techs = (
      await t.http
        .get(`/api/v1/dealerships/${DEALERSHIP.LEEDS}/technicians`)
        .set(asAcme())
        .expect(200)
    ).body;
    expect(techs).toHaveLength(4);
    expect(techs.find((x: { id: string }) => x.id === TECHNICIAN.LEEDS_ALEX)).toMatchObject({
      active: true,
      skills: ['EV_HIGH_VOLTAGE', 'GENERAL'],
    });
    expect(
      techs.find((x: { id: string }) => x.id === TECHNICIAN.LEEDS_DORA_INACTIVE),
    ).toMatchObject({ active: false });
    const bays = (
      await t.http
        .get(`/api/v1/dealerships/${DEALERSHIP.LEEDS}/service-bays`)
        .set(asAcme())
        .expect(200)
    ).body;
    expect(bays.find((b: { id: string }) => b.id === BAY.LEEDS_ALIGN)).toMatchObject({
      capabilities: ['ALIGNMENT_RIG', 'LIFT'],
    });
  });

  it('another tenant’s dealership routes → 404', async () => {
    await t.http
      .get(`/api/v1/dealerships/${DEALERSHIP.LEEDS}/technicians`)
      .set(asBeta())
      .expect(404);
    await t.http
      .get(`/api/v1/dealerships/${DEALERSHIP.LEEDS}/service-bays`)
      .set(asBeta())
      .expect(404);
  });
});
