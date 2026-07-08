import { describe, expect, it } from 'vitest';
import { computePlannerStats } from './wasm-skill-planner';
import type { WasmCompareData, WasmCompareRoundData } from '@/lib/uma-sim-wasm/types';

function roundWithPositions(
  seed: number,
  positions: Array<number>
): WasmCompareData['rounds'][number] {
  const runner = {
    runnerId: 0,
    time: [],
    position: positions,
    velocity: [],
    hp: [],
    currentLane: [],
    pacerGap: [],
    order: [],
    skillActivations: {},
    targetedSkillActivations: {},
    startDelay: 0,
    rushed: [],
    hasAchievedFullSpurt: true,
    outOfHp: false,
    firstPositionInLateRace: false,
    usedSkills: [],
    finished: true,
    finishPosition: positions[positions.length - 1] ?? 0
  } satisfies WasmCompareRoundData;
  return { seed, runners: [runner] };
}

function compareData(rounds: Array<Array<number>>): WasmCompareData {
  return { rounds: rounds.map((positions, i) => roundWithPositions(i, positions)) };
}

describe('computePlannerStats', () => {
  it('computes bashin deltas as (candidate - baseline) / 2.5 at the final aligned frame', () => {
    // Candidate finishes 5m ahead in round 0, 2.5m ahead in round 1.
    const baseline = compareData([
      [0, 100, 200],
      [0, 100, 200]
    ]);
    const candidate = compareData([
      [0, 100, 205],
      [0, 100, 202.5]
    ]);

    const stats = computePlannerStats(baseline, candidate, 2);

    // 5 / 2.5 = 2 bashin ; 2.5 / 2.5 = 1 bashin
    expect(stats.results).toEqual([1, 2]);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(2);
    expect(stats.mean).toBe(1.5);
    expect(stats.median).toBe(1.5);
  });

  it('uses the shorter series length when the runners finish on different frames', () => {
    // Baseline has 3 frames, candidate has 2 — diff taken at frame index 1.
    const baseline = compareData([[0, 100, 200]]);
    const candidate = compareData([[0, 110]]);

    const stats = computePlannerStats(baseline, candidate, 1);

    // (110 - 100) / 2.5 = 4 bashin
    expect(stats.results).toEqual([4]);
    expect(stats.mean).toBe(4);
  });

  it('produces an odd-count median from the middle element', () => {
    const baseline = compareData([
      [0, 200],
      [0, 200],
      [0, 200]
    ]);
    const candidate = compareData([
      [0, 202.5],
      [0, 205],
      [0, 207.5]
    ]);

    const stats = computePlannerStats(baseline, candidate, 3);

    expect(stats.results).toEqual([1, 2, 3]);
    expect(stats.median).toBe(2);
    expect(stats.mean).toBe(2);
  });

  it('throws when a round is missing collected runner data', () => {
    const baseline = compareData([[0, 200]]);
    const candidate = compareData([[]]);

    expect(() => computePlannerStats(baseline, candidate, 1)).toThrow(
      'Missing collected runner data for planner comparison'
    );
  });
});
