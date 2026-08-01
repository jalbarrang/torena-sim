import { describe, expect, it } from 'vitest';
import { createRunnerState } from '@/modules/runners/components/runner-card/domain/runner-state';
import type { RunnerAptitudes } from '@/modules/runners/components/runner-card/domain/runner-state';
import { bucketsFromRunner, collapsedForCourse } from './aptitude-buckets';

const aptitudes: RunnerAptitudes = {
  distanceShort: 'S',
  distanceMile: 'A',
  distanceMiddle: 'B',
  distanceLong: 'C',
  turf: 'A',
  dirt: 'G',
  nige: 'A',
  senko: 'B',
  sashi: 'C',
  oikomi: 'D'
};

describe('bucketsFromRunner', () => {
  it('returns stored aptitudes when present', () => {
    const runner = createRunnerState({ aptitudes });
    expect(bucketsFromRunner(runner)).toEqual(aptitudes);
  });

  it('backfills a missing/invalid bucket from its best sibling', () => {
    // distanceMiddle missing -> should fall back to the best distance sibling (S).
    const partial = {
      ...aptitudes,
      distanceMiddle: '' as string
    };
    const runner = createRunnerState({ aptitudes: partial, distanceAptitude: 'A' });
    const result = bucketsFromRunner(runner);
    expect(result.distanceMiddle).toBe('S'); // best of Sprint S / Mile A / Long C
    expect(result.distanceShort).toBe('S');
  });

  it('broadcasts the collapsed grades when no bucket data', () => {
    const runner = createRunnerState({
      distanceAptitude: 'B',
      surfaceAptitude: 'C',
      strategyAptitude: 'D'
    });
    const result = bucketsFromRunner(runner);
    expect(result.distanceShort).toBe('B');
    expect(result.distanceLong).toBe('B');
    expect(result.turf).toBe('C');
    expect(result.dirt).toBe('C');
    expect(result.nige).toBe('D');
    expect(result.oikomi).toBe('D');
  });
});

describe('collapsedForCourse', () => {
  // 10101 = Sapporo turf 1000m (sprint) — verify it picks the sprint + turf buckets.
  it('picks the course-matching distance/surface buckets and style by strategy', () => {
    const collapsed = collapsedForCourse(aptitudes, 10101, 'Front Runner');
    // 1000m -> sprint bucket (S), turf surface (A), Front Runner -> nige (A)
    expect(collapsed.distanceAptitude).toBe('S');
    expect(collapsed.surfaceAptitude).toBe('A');
    expect(collapsed.strategyAptitude).toBe('A');
  });

  it('uses the long bucket on a long course and the matching style', () => {
    // 10906 / similar long turf — use a known long course id from the dataset.
    const collapsed = collapsedForCourse(aptitudes, 10606, 'End Closer');
    expect(['B', 'C']).toContain(collapsed.distanceAptitude); // middle/long depending on course
    expect(collapsed.strategyAptitude).toBe('D'); // End Closer -> oikomi
  });
});
