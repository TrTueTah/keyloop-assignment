import { LeastLoadedPolicy, ResourceCandidate } from '../../../src/domain/allocation-policy';

const c = (id: string, bookedMinutes: number, capabilityCount = 0): ResourceCandidate => ({
  id,
  bookedMinutes,
  capabilityCount,
});

describe('LeastLoadedPolicy', () => {
  const policy = new LeastLoadedPolicy();

  it('ranks by booked minutes ascending', () => {
    expect(policy.rank([c('a', 120), c('b', 30), c('c', 60)]).map((x) => x.id)).toEqual([
      'b',
      'c',
      'a',
    ]);
  });

  it('breaks load ties by fewer capabilities (keeps specialist bays free)', () => {
    const ranked = policy.rank([c('ev-bay', 60, 2), c('plain-bay', 60, 1)]);
    expect(ranked[0].id).toBe('plain-bay');
  });

  it('breaks remaining ties by id, deterministically', () => {
    expect(policy.rank([c('z', 0, 1), c('a', 0, 1), c('m', 0, 1)]).map((x) => x.id)).toEqual([
      'a',
      'm',
      'z',
    ]);
  });

  it('does not mutate its input', () => {
    const input = [c('b', 10), c('a', 5)];
    policy.rank(input);
    expect(input.map((x) => x.id)).toEqual(['b', 'a']);
  });

  it('SC-007: sequential auto-assignment keeps the load spread within the longest duration', () => {
    const durations = [30, 180, 60, 90, 30, 60, 180, 30, 60, 90, 30, 60, 30, 120, 60, 30];
    const load = new Map<string, number>([
      ['t1', 0],
      ['t2', 0],
      ['t3', 0],
    ]);
    for (const d of durations) {
      const [winner] = policy.rank([...load].map(([id, minutes]) => c(id, minutes)));
      load.set(winner.id, load.get(winner.id)! + d);
    }
    const values = [...load.values()];
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(Math.max(...durations));
  });
});
