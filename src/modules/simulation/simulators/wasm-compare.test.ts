import { describe, expect, it, vi } from 'vitest';
import type { CollectedRunnerRoundData } from '@/lib/uma-domain/race/race-observer';
import type { CourseData } from '@/lib/uma-domain/course/definitions';
import type { RaceParameters } from '@/lib/uma-domain/race/types';
import { createRunnerState } from '@/modules/runners/components/runner-card/types';
import type { CompareParams } from '@/modules/simulation/types';
import type {
  WasmCompareData,
  WasmCompareParams,
  WasmCompareRoundData,
  WasmContestedCompareParams
} from '@/lib/uma-sim-wasm/types';
import { buildComparePlan } from './wasm-compare-plan';
import {
  reduceCompareRoundsPublic,
  runComparisonRoundsFromPlan,
  splitContestedCompareRounds,
  type ComparePlan
} from './wasm-compare';
import { runCompare, runContestedCompare } from '@/lib/uma-sim-wasm/loader';

vi.mock('@/lib/uma-sim-wasm/loader', () => ({
  runCompare: vi.fn(),
  runContestedCompare: vi.fn()
}));

const mockedRunCompare = vi.mocked(runCompare);
const mockedRunContestedCompare = vi.mocked(runContestedCompare);

const course: CourseData = {
  courseId: 10101,
  raceTrackId: 101,
  distance: 2000,
  distanceType: 3,
  surface: 1,
  turn: 2,
  courseSetStatus: [1, 2],
  corners: [{ start: 400, length: 100 }],
  straights: [{ start: 0, end: 400 }],
  slopes: [{ start: 900, length: 50, slope: -1.5 }],
  laneMax: 18,
  courseWidth: 30,
  horseLane: 1.2,
  laneChangeAcceleration: 0.1,
  laneChangeAccelerationPerFrame: 0.01,
  maxLaneDistance: 2,
  moveLanePoint: 0.5,
  isAbroad: false
};

const racedef: RaceParameters = {
  ground: 1,
  weather: 1,
  season: 1,
  timeOfDay: 1,
  grade: 100
};

function compareParams(overrides: Partial<CompareParams> = {}): CompareParams {
  return {
    nsamples: 8,
    course,
    racedef,
    uma1: createRunnerState({ speed: 1200, skills: [] }),
    uma2: createRunnerState({ speed: 1210, skills: [] }),
    options: {
      seed: 42,
      allowRushedUma1: true,
      allowRushedUma2: false,
      allowDownhillUma1: false,
      allowDownhillUma2: true,
      allowConservePowerUma1: true,
      allowConservePowerUma2: false,
      allowSectionModifierUma1: true,
      allowSectionModifierUma2: false,
      useEnhancedSpurt: false,
      accuracyMode: false,
      skillCheckChanceUma1: true,
      skillCheckChanceUma2: false,
      staminaDrainOverrides: { test: 0.5 }
    },
    ...overrides
  };
}

function wasmRunner(runnerId: number, overrides: Partial<WasmCompareRoundData> = {}): WasmCompareRoundData {
  return {
    runnerId,
    time: [0, 1],
    position: [0, runnerId === 0 ? 100 : 105],
    velocity: [20, 21],
    hp: [1000, runnerId === 0 ? 900 : 850],
    currentLane: [1, 1],
    pacerGap: [0, 0],
    skillActivations: {},
    targetedSkillActivations: {},
    startDelay: 0,
    rushed: [],
    hasAchievedFullSpurt: true,
    outOfHp: false,
    firstPositionInLateRace: runnerId === 0,
    usedSkills: [],
    finished: true,
    finishPosition: runnerId === 0 ? 100 : 105,
    ...overrides
  };
}

function collectedRunner(
  runnerId: number,
  overrides: Partial<CollectedRunnerRoundData> = {}
): CollectedRunnerRoundData {
  return {
    runnerId,
    time: [0, 1],
    position: [0, runnerId === 0 ? 110 : 100],
    velocity: [20, 21],
    hp: [1000, 900],
    currentLane: [1, 1],
    pacerGap: [0, 0],
    skillActivations: {},
    targetedSkillActivations: {},
    startDelay: 0,
    rushed: [],
    duelingRegion: [],
    spotStruggleRegion: [],
    fullyChargedRegion: [],
    fullyChargedAccel: null,
    hasAchievedFullSpurt: true,
    outOfHp: false,
    outOfHpPosition: null,
    nonFullSpurtVelocityDiff: null,
    nonFullSpurtDelayDistance: null,
    firstPositionInLateRace: runnerId === 0,
    usedSkills: [],
    finished: true,
    finishPosition: runnerId === 0 ? 110 : 100,
    ...overrides
  };
}

function wasmData(rounds: Array<WasmCompareRoundData[]>): WasmCompareData {
  return {
    rounds: rounds.map((runners, index) => ({ seed: index, runners }))
  };
}

describe('buildComparePlan', () => {
  it('builds the vacuum plan shape by default', () => {
    const plan = buildComparePlan(compareParams());

    expect(plan.mode).toBe('vacuum');
    if (plan.mode !== 'vacuum') throw new Error('expected vacuum plan');
    expect(plan.wasmParamsA.masterSeed).toBe(42);
    expect(plan.wasmParamsB.masterSeed).toBe(42);
    expect(plan.nsamples).toBe(8);
  });

  it('builds the contested plan shape with both runners in one envelope', () => {
    const plan = buildComparePlan(compareParams(), { mode: 'contested', contestedField: 'mobs' });

    expect(plan.mode).toBe('contested');
    if (plan.mode !== 'contested') throw new Error('expected contested plan');
    expect(plan.wasmParamsContested.runners).toHaveLength(2);
    expect(plan.wasmParamsContested.fillMobs).toBe(true);
    expect(plan.wasmParamsContested.masterSeed).toBe(42);
    expect(plan.wasmParamsContested.settings?.rushed).toBe(true);
    expect('duelingRates' in plan.wasmParamsContested).toBe(false);
  });
});

describe('splitContestedCompareRounds', () => {
  it('splits same-race rounds by compared runner id', () => {
    const rounds = splitContestedCompareRounds(
      wasmData([
        [wasmRunner(1, { hp: [1000, 800] }), wasmRunner(0, { hp: [1000, 900] })],
        [wasmRunner(0, { position: [0, 101] }), wasmRunner(1, { position: [0, 99] })]
      ])
    );

    expect(rounds.roundsA.map((round) => round.runnerId)).toEqual([0, 0]);
    expect(rounds.roundsB.map((round) => round.runnerId)).toEqual([1, 1]);
    expect(rounds.roundsA[0].hp).toEqual([1000, 900]);
    expect(rounds.roundsB[0].hp).toEqual([1000, 800]);
  });

  it('fails loudly when a compared runner id is missing', () => {
    expect(() => splitContestedCompareRounds(wasmData([[wasmRunner(0)]]))).toThrow(
      'Missing compared runner 1 in contested compare round 0'
    );
  });
});

describe('runComparisonRoundsFromPlan', () => {
  it('runs one contested batch per chunk with offset seed and aligned samples', async () => {
    mockedRunContestedCompare.mockResolvedValueOnce(wasmData([[wasmRunner(0), wasmRunner(1)]]));

    const plan: ComparePlan = {
      mode: 'contested',
      wasmParamsContested: { runners: [{ name: 'A' }, { name: 'B' }] } as WasmContestedCompareParams,
      nsamples: 4,
      baseSeed: 100
    };

    const rounds = await runComparisonRoundsFromPlan(plan, 1, 2);

    expect(mockedRunContestedCompare).toHaveBeenCalledWith(
      expect.objectContaining({ masterSeed: 102, nsamples: 1 })
    );
    expect(mockedRunCompare).not.toHaveBeenCalled();
    expect(rounds.roundsA).toHaveLength(1);
    expect(rounds.roundsB).toHaveLength(1);
  });

  it('keeps vacuum chunk seed inputs deterministic across split chunks', async () => {
    mockedRunCompare.mockResolvedValue(wasmData([[wasmRunner(0)], [wasmRunner(0)]]));

    const plan: ComparePlan = {
      mode: 'vacuum',
      wasmParamsA: {} as WasmCompareParams,
      wasmParamsB: {} as WasmCompareParams,
      nsamples: 4,
      baseSeed: 10
    };

    await runComparisonRoundsFromPlan(plan, 2, 0);
    await runComparisonRoundsFromPlan(plan, 2, 2);

    expect(mockedRunCompare.mock.calls.map(([params]) => [params.masterSeed, params.nsamples])).toEqual([
      [10, 2],
      [10, 2],
      [12, 2],
      [12, 2]
    ]);
  });
});

describe('reduceCompareRoundsPublic', () => {
  it('keeps same-race first-place and spot-struggle stats per runner', () => {
    const results = reduceCompareRoundsPublic(
      {
        roundsA: [
          collectedRunner(0, {
            firstPositionInLateRace: true,
            spotStruggleRegion: [200, 220],
            position: [0, 105]
          }),
          collectedRunner(0, {
            firstPositionInLateRace: false,
            spotStruggleRegion: [210, 225],
            position: [0, 95]
          })
        ],
        roundsB: [
          collectedRunner(1, {
            firstPositionInLateRace: false,
            spotStruggleRegion: [200, 218],
            position: [0, 100]
          }),
          collectedRunner(1, {
            firstPositionInLateRace: true,
            spotStruggleRegion: [210, 230],
            position: [0, 100]
          })
        ]
      },
      2
    );

    expect(results.firstUmaStats.uma1.firstPlaceRate).toBe(50);
    expect(results.firstUmaStats.uma2.firstPlaceRate).toBe(50);
    expect(results.leadCompetitionStats.uma1.frequency).toBe(100);
    expect(results.leadCompetitionStats.uma2.frequency).toBe(100);
    expect(results.leadCompetitionStats.uma1.mean).toBe(17.5);
    expect(results.leadCompetitionStats.uma2.mean).toBe(19);
  });
});
