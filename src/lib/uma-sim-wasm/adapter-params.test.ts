import { describe, expect, it } from 'vitest';
import { contestedCompareParamsToWasm } from './adapter-params';
import type { CourseData } from '@/lib/uma-domain/course/definitions';
import type { CreateRunner } from '@/lib/uma-domain/runner/types';
import type { RaceParameters, SimulationSettings } from '@/lib/uma-domain/race/types';

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

const parameters: RaceParameters = {
  ground: 1,
  weather: 1,
  season: 1,
  timeOfDay: 1,
  grade: 100
};

const settings: SimulationSettings = {
  mode: 'compare',
  healthSystem: true,
  sectionModifier: true,
  rushed: true,
  downhill: true,
  conservePower: true,
  spotStruggle: true,
  dueling: true,
  witChecks: true,
  positionKeepMode: 2,
  staminaDrainOverrides: {}
};

function runner(overrides: Partial<CreateRunner> = {}): CreateRunner {
  return {
    outfitId: 'test-outfit',
    mood: 0,
    strategy: 1,
    aptitudes: {
      distance: 1,
      strategy: 1,
      surface: 1
    },
    stats: {
      speed: 900,
      stamina: 800,
      power: 700,
      guts: 600,
      wit: 500
    },
    skills: [],
    ...overrides
  };
}

describe('contestedCompareParamsToWasm', () => {
  it('builds a contested envelope without vacuum-only dueling rates', () => {
    const params = contestedCompareParamsToWasm({
      course,
      parameters,
      settings,
      runners: [
        runner({ forcedSpotStruggleRegions: [{ start: 200, end: 260 }] }),
        runner({ forcedDuelingRegions: [{ start: 700, end: 760 }] })
      ],
      names: ['Alpha', 'Beta'],
      fillMobs: true,
      nsamples: 12,
      masterSeed: 99
    });

    expect(params.runners).toHaveLength(2);
    expect(params.runners[0].name).toBe('Alpha');
    expect(params.runners[0].forcedSpotStruggleRegions).toEqual([{ start: 200, end: 260 }]);
    expect(params.runners[1].forcedDuelingRegions).toEqual([{ start: 700, end: 760 }]);
    expect(params.fillMobs).toBe(true);
    expect(params.nsamples).toBe(12);
    expect(params.masterSeed).toBe(99);
    expect('duelingRates' in params).toBe(false);
  });
});
