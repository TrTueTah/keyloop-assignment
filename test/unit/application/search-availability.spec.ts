import { DateTime } from 'luxon';
import { SearchAvailability } from '../../../src/application/use-cases/search-availability';
import { FindAlternatives } from '../../../src/application/use-cases/find-alternatives';
import { ResourceQuery } from '../../../src/application/ports/resource.query';
import { SiteContext } from '../../../src/application/tenant-context';
import { interval } from '../../../src/domain/interval';
import {
  DEALERSHIP,
  SERVICE_TYPE,
  TENANT,
} from '../../../src/infrastructure/persistence/seed/fixtures';
import { FakeClock } from './fakes/fake-clock';
import { dealerships, InMemoryReference, serviceTypes } from './fakes/in-memory-reference';
import { RecordingTelemetry } from './fakes/recording-telemetry';

const ctx: SiteContext = { tenantId: TENANT.ACME, dealershipId: DEALERSHIP.LEEDS, userId: 'u' };
const t = (iso: string) => DateTime.fromISO(iso, { zone: 'utc' });

function resources(): ResourceQuery & { snapshotCalls: { start: string; end: string }[] } {
  const snapshotCalls: { start: string; end: string }[] = [];
  return {
    snapshotCalls,
    findCandidates: async () => ({ technicians: [], bays: [] }),
    getTechnician: async () => null,
    getBay: async () => null,
    availabilitySnapshot: async (_c, _s, range) => {
      snapshotCalls.push({ start: range.start.toISO()!, end: range.end.toISO()! });
      return {
        technicians: [
          { id: 't1', busy: [interval(t('2026-11-10T08:00:00Z'), t('2026-11-10T16:30:00Z'))] },
        ],
        bays: [{ id: 'b1', busy: [] }],
      };
    },
  };
}

describe('SearchAvailability (orchestration)', () => {
  it('loads ONE snapshot for the local day, computes inside a span, renders local offsets', async () => {
    const res = resources();
    const telemetry = new RecordingTelemetry();
    const out = await new SearchAvailability(
      new InMemoryReference(),
      res,
      new FakeClock(),
      telemetry,
    ).execute(ctx, SERVICE_TYPE.OIL, '2026-11-10');
    expect(res.snapshotCalls).toHaveLength(1);
    expect(telemetry.spans).toContain('computeAvailability');
    expect(out).toMatchObject({ date: '2026-11-10', timezone: 'Europe/London' });
    expect(out.slots.map((s) => s.startAt)).toEqual(['2026-11-10T16:30:00+00:00']);
  });

  it('unknown or other-tenant service type → NOT_FOUND', async () => {
    const uc = new SearchAvailability(
      new InMemoryReference(),
      resources(),
      new FakeClock(),
      new RecordingTelemetry(),
    );
    await expect(uc.execute(ctx, SERVICE_TYPE.BETA_OIL, '2026-11-10')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('FindAlternatives (orchestration)', () => {
  it('uses ONE snapshot spanning the requested day + 7 days and returns ≤ 5 local-offset slots', async () => {
    const res = resources();
    const telemetry = new RecordingTelemetry();
    const leeds = dealerships.find((d) => d.id === DEALERSHIP.LEEDS)!;
    const oil = serviceTypes.find((s) => s.id === SERVICE_TYPE.OIL)!;
    const out = await new FindAlternatives(res, new FakeClock(), telemetry).execute(
      ctx,
      oil,
      leeds,
      t('2026-11-10T10:00:00Z'),
    );
    expect(res.snapshotCalls).toEqual([
      { start: '2026-11-10T00:00:00.000+00:00', end: '2026-11-18T00:00:00.000+00:00' },
    ]);
    expect(telemetry.spans).toContain('findAlternatives');
    expect(out.map((s) => s.startAt)).toEqual([
      '2026-11-10T16:30:00+00:00',
      '2026-11-11T08:00:00+00:00',
      '2026-11-11T08:15:00+00:00',
      '2026-11-11T08:30:00+00:00',
      '2026-11-11T08:45:00+00:00',
    ]);
  });
});
