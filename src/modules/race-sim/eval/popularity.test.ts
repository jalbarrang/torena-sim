import { describe, it, expect } from 'vitest';
import { createRunnerState } from '@/modules/runners/components/runner-card/domain/runner-state';
import type { IRunnerState } from '@/modules/runners/components/runner-card/domain/runner-state';
import { computeFieldPopularity } from './popularity';

const runner = (props: Partial<IRunnerState>): IRunnerState => createRunnerState(props);

describe('computeFieldPopularity', () => {
  it('ranks by rank score descending (1 = most popular)', () => {
    const field = [
      runner({ outfitId: '100101', rankScore: 10000 }),
      runner({ outfitId: '100201', rankScore: 30000 }),
      runner({ outfitId: '100301', rankScore: 20000 })
    ];
    expect(computeFieldPopularity(field)).toEqual([3, 1, 2]);
  });

  it('honours a manual override and fills the rest by score', () => {
    const field = [
      runner({ outfitId: '100101', rankScore: 30000 }), // would be #1 by score
      runner({ outfitId: '100201', rankScore: 20000, popularity: 1 }), // forced #1
      runner({ outfitId: '100301', rankScore: 10000 })
    ];
    // Forced #1 takes rank 1; remaining fill 2,3 by score (idx0 then idx2).
    expect(computeFieldPopularity(field)).toEqual([2, 1, 3]);
  });

  it('ignores out-of-range or duplicate overrides', () => {
    const field = [
      runner({ outfitId: '100101', rankScore: 30000, popularity: 99 }), // out of range
      runner({ outfitId: '100201', rankScore: 20000, popularity: 2 }),
      runner({ outfitId: '100301', rankScore: 10000, popularity: 2 }) // duplicate of #2
    ];
    // idx1 keeps forced #2. Remaining ranks 1,3 fill by score: idx0 (30000)->1, idx2 (10000)->3.
    expect(computeFieldPopularity(field)).toEqual([1, 2, 3]);
  });
});
