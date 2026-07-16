import { describe, expect, it } from 'vitest';
import { contestedCompareParamsToWasm, resolveSkillInput } from './adapter-params';
import type { CourseData } from '@/lib/uma-domain/course/definitions';
import type { CreateRunner } from '@/lib/uma-domain/runner/types';
import type { RaceParameters, SimulationSettings } from '@/lib/uma-domain/race/types';
import { initSkillService, type SkillEntry } from '@/modules/data/services/SkillService';

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

function skillEntry(tags?: Array<number>): SkillEntry {
  return {
    id: '200011',
    rarity: 1,
    tags: tags ?? [],
    alternatives: [],
    groupId: 20001,
    versions: [],
    family: [],
    iconId: '20001',
    baseCost: 0,
    gradeValue: 0,
    order: 0,
    name: 'Right-Handed ◎',
    character: []
  };
}

describe('resolveSkillInput', () => {
  it('carries authoritative master-data tags to the WASM DTO', () => {
    initSkillService({
      skills: { '200011': skillEntry([401, 608]) },
      releasedSkillIds: new Set(['200011']),
      activationChecks: {}
    });

    expect(resolveSkillInput('200011')?.tags).toEqual([401, 608]);
  });

  it('defaults legacy skill entries with omitted tags to an empty array', () => {
    const legacyEntry = skillEntry();
    delete (legacyEntry as Partial<SkillEntry>).tags;
    initSkillService({
      skills: { '200011': legacyEntry },
      releasedSkillIds: new Set(['200011']),
      activationChecks: {}
    });

    expect(resolveSkillInput('200011')?.tags).toEqual([]);
  });

  it('excludes non-simulatable skills so they never reach the WASM DTO boundary', () => {
    // An unsupported value usage (13, max-raw-stat scaling) would hard-fail
    // the whole worker run at the DTO boundary; the resolver must drop it.
    const entry = skillEntry();
    entry.alternatives = [
      {
        baseDuration: 3,
        condition: 'phase_random==2',
        effects: [{ target: 1, type: 27, modifier: 2000, valueUsage: 13 }]
      }
    ];
    initSkillService({
      skills: { '200011': entry },
      releasedSkillIds: new Set(['200011']),
      activationChecks: {}
    });

    expect(resolveSkillInput('200011')).toBeNull();
  });

  it('resolves Aoharu-scaled skills (usage 5) as simulatable inputs', () => {
    const entry = skillEntry();
    entry.alternatives = [
      {
        baseDuration: 1.2,
        condition: 'phase_random==2',
        effects: [{ target: 1, type: 31, modifier: 2000, valueUsage: 5 }]
      }
    ];
    initSkillService({
      skills: { '200011': entry },
      releasedSkillIds: new Set(['200011']),
      activationChecks: {}
    });

    expect(resolveSkillInput('200011')?.alternatives[0]?.effects[0]?.valueUsage).toBe(5);
  });
});
