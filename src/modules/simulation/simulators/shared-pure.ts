// Data-free simulation helpers. NOTHING here may import `@/modules/data/**`,
// so this module is safe to import from `src/workers/**` (worker-side reducers
// use `isSameSkill` / `computePositionDiff` / runner+settings converters). The
// data-dependent helpers (skill effect metadata, group sorter) live in
// `shared.ts`, which must stay main-thread-only.

import type { IRunnerState } from '@/modules/runners/components/runner-card/types';
import type { CreateRunner } from '@/lib/uma-domain/runner/types';
import type {
  DuelingRates,
  SimulationSettings,
  RaceParameters as SundayRaceParameters
} from '@/lib/uma-domain/race/types';
import type { ISkillTarget, ISkillType } from '@/lib/uma-domain/skills/definitions';
import type {
  InjectedDebuff,
  RunComparisonParams,
  ScenarioOverrides
} from '@/modules/simulation/types';
import { parseAptitudeName, parseStrategyName } from '@/lib/uma-domain/runner/runner.types';

export type EffectMeta = {
  effectType: ISkillType;
  effectTarget: ISkillTarget;
};

export const DEFAULT_DUELING_RATES: DuelingRates = {
  runaway: 10,
  frontRunner: 10,
  paceChaser: 10,
  lateSurger: 10,
  endCloser: 10
};

export function normalizeSkillId(skillId: string): string {
  return skillId.split('-', 1)[0] ?? skillId;
}

export function isSameSkill(skillIdA: string, skillIdB: string): boolean {
  return skillIdA === skillIdB || normalizeSkillId(skillIdA) === normalizeSkillId(skillIdB);
}

/**
 * Data-free group sorter: orders skills by the position of their group's first
 * occurrence in the (numerically-sorted) skill set, falling back to id order.
 * `groupIdOf` resolves a normalized skill id to its group id (or `undefined`);
 * the data-backed wrapper lives in `shared.ts`.
 */
export function createSkillSorterByGroupWith(
  allSkills: Array<string>,
  groupIdOf: (normalizedSkillId: string) => number | undefined
) {
  const commonSkills = Array.from(new Set(allSkills.toSorted((a, b) => +a - +b)));

  const getCommonGroupIndex = (id: string) => {
    const groupId = groupIdOf(normalizeSkillId(id));
    if (groupId == null) return commonSkills.length;

    const index = commonSkills.findIndex(
      (skillId) => groupIdOf(normalizeSkillId(skillId)) === groupId
    );
    return index !== -1 ? index : commonSkills.length;
  };

  return (a: string, b: string) => {
    const groupIndexA = getCommonGroupIndex(a);
    const groupIndexB = getCommonGroupIndex(b);
    if (groupIndexA !== groupIndexB) {
      return groupIndexA - groupIndexB;
    }
    return +normalizeSkillId(a) - +normalizeSkillId(b);
  };
}

export function toCreateRunner(
  runner: IRunnerState,
  sortedSkills: Array<string>,
  forcedPositions?: Record<string, number>,
  injectedDebuffs?: Array<InjectedDebuff>,
  scenarioOverrides?: ScenarioOverrides,
  popularity?: number
): CreateRunner {
  return {
    outfitId: runner.outfitId,
    mood: runner.mood,
    strategy: parseStrategyName(runner.strategy),
    popularity,
    aptitudes: {
      distance: parseAptitudeName(runner.distanceAptitude),
      surface: parseAptitudeName(runner.surfaceAptitude),
      strategy: parseAptitudeName(runner.strategyAptitude)
    },
    stats: {
      speed: runner.speed,
      stamina: runner.stamina,
      power: runner.power,
      guts: runner.guts,
      wit: runner.wisdom
    },
    skills: sortedSkills,
    // IRunnerState.gate is the 1-based post; the engine expects a 0-based gate.
    gate: typeof runner.gate === 'number' ? runner.gate - 1 : undefined,
    // CM/LoH team grouping: teammates are excluded from debuff effects.
    team: typeof runner.team === 'number' ? runner.team : undefined,
    forcedPositions,
    injectedDebuffs: injectedDebuffs?.map(({ skillId, position }) => ({ skillId, position })),
    forcedRushedRegions: scenarioOverrides?.forcedRushed
      ? [scenarioOverrides.forcedRushed]
      : undefined,
    forcedDuelingRegions: scenarioOverrides?.forcedDueling
      ? [scenarioOverrides.forcedDueling]
      : undefined,
    forcedSpotStruggleRegions: scenarioOverrides?.forcedSpotStruggle
      ? [scenarioOverrides.forcedSpotStruggle]
      : undefined,
    forcedRank: scenarioOverrides?.forcedRank
  };
}

export function toSundayRaceParameters(
  racedef: RunComparisonParams['racedef']
): SundayRaceParameters {
  const race = racedef as Record<string, unknown>;

  const ground = (race.ground ?? race.groundCondition) as SundayRaceParameters['ground'];
  const weather = race.weather as SundayRaceParameters['weather'];
  const season = race.season as SundayRaceParameters['season'];
  const timeOfDay = (race.timeOfDay ?? race.time) as SundayRaceParameters['timeOfDay'];
  const grade = race.grade as SundayRaceParameters['grade'];

  if (ground == null || weather == null || season == null || timeOfDay == null || grade == null) {
    throw new Error('Invalid race conditions for Sunday engine migration');
  }

  return { ground, weather, season, timeOfDay, grade };
}

export function createCompareSettings(
  overrides: Partial<Omit<SimulationSettings, 'mode'>> = {}
): SimulationSettings {
  return {
    mode: 'compare',
    healthSystem: false,
    sectionModifier: false,
    rushed: false,
    downhill: false,
    conservePower: false,
    spotStruggle: false,
    dueling: false,
    witChecks: false,
    positionKeepMode: 0,
    staminaDrainOverrides: {},
    ...overrides
  };
}

export function computePositionDiff(positionA: Array<number>, positionB: Array<number>): number {
  if (positionA.length === 0 || positionB.length === 0) {
    throw new Error('Position data is empty while computing position difference');
  }

  if (positionB.length <= positionA.length) {
    const bFrames = positionB.length;
    return positionB[bFrames - 1] - positionA[bFrames - 1];
  }

  const aFrames = positionA.length;
  return positionB[aFrames - 1] - positionA[aFrames - 1];
}
