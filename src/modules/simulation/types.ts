import type { IRunnerState } from '@/modules/runners/components/runner-card/domain/runner-state';
import type {
  SimulationData,
  SkillSimulationData,
  SkillTrackedMetaCollection
} from '@/modules/simulation/compare.types';
import type { CourseData } from '@/lib/uma-domain/course/definitions';
import type { RaceParameters } from '@/lib/uma-domain/race/types';

type FilterReason = 'negligible-effect' | 'low-variance' | null;

export type RoundResult = {
  id: string;
  results: Array<number>;
  runData?: SimulationData;
  min: number;
  max: number;
  mean: number;
  median: number;
  filterReason?: FilterReason;
};

type SkillBasinResponse = Record<string, RoundResult>;

export type SkillComparisonRoundResult = {
  id: string;
  results: Array<number>;
  skillActivations: Record<string, SkillTrackedMetaCollection>;
  runData: SkillSimulationData;
  min: number;
  max: number;
  mean: number;
  median: number;
  filterReason: FilterReason | undefined;
};

export type SkillComparisonResponse = Record<string, SkillComparisonRoundResult>;

export type PoolMetrics = {
  timeTaken: number;
  totalSamples: number;
  workerCount: number;
  skillsProcessed: number;
};

export interface SimulationOptions {
  seed?: number;
  useEnhancedSpurt?: boolean;
  accuracyMode?: boolean;
  mode?: string;
  ignoreStaminaConsumption?: boolean;

  // Wit Variance
  allowRushedUma1: boolean;
  allowRushedUma2: boolean;
  allowDownhillUma1: boolean;
  allowDownhillUma2: boolean;
  allowConservePowerUma1?: boolean;
  allowConservePowerUma2?: boolean;
  allowSectionModifierUma1: boolean;
  allowSectionModifierUma2: boolean;
  skillCheckChanceUma1: boolean;
  skillCheckChanceUma2: boolean;
  staminaDrainOverrides?: Record<string, number>;
}

export type RunComparisonParams = {
  nsamples: number;
  course: CourseData;
  racedef: RaceParameters;
  runnerA: IRunnerState;
  runnerB: IRunnerState;
  options: SimulationOptions;
};

type ForcedPositionsMap = {
  uma1: Record<string, number>;
  uma2: Record<string, number>;
};

export type InjectedDebuff = {
  id: string;
  skillId: string;
  position: number;
};

export type InjectedDebuffsMap = {
  uma1: Array<InjectedDebuff>;
  uma2: Array<InjectedDebuff>;
};

export type ForcedRegion = { start: number; end: number };
export type ForcedRankRegion = ForcedRegion & { rank: number };

export type ScenarioOverrides = {
  forcedRushed: ForcedRegion | null;
  forcedDueling: ForcedRegion | null;
  forcedSpotStruggle: ForcedRegion | null;
  forcedRank: Array<ForcedRankRegion>;
};

export type ScenarioOverridesMap = {
  uma1: ScenarioOverrides;
  uma2: ScenarioOverrides;
};

export type CompareParams = {
  nsamples: number;
  course: CourseData;
  racedef: RaceParameters;
  uma1: IRunnerState;
  uma2: IRunnerState;
  options: SimulationOptions;
  forcedPositions?: ForcedPositionsMap;
  injectedDebuffs?: InjectedDebuffsMap;
  scenarioOverrides?: ScenarioOverridesMap;
};

export type Run1RoundParams = {
  nsamples: number;
  skills: Array<string>;
  course: CourseData;
  racedef: RaceParameters;
  uma: IRunnerState;
  options: SimulationOptions;
};
