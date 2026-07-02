import type { IRunnerState } from '@/modules/runners/components/runner-card/types';
import type { WitVarianceSettings, StaminaDrainOverrides } from '@/store/settings.store';
import type { RaceConditions } from '@/utils/races';
import type { InjectedDebuffsMap, ScenarioOverridesMap } from '@/modules/simulation/types';
import type { CompareMode, FieldComposition } from '@/modules/simulation/stores/compare.store';

export const SIMULATION_SNAPSHOT_VERSION = 1 as const;

export type SimulationSnapshot = {
  version: typeof SIMULATION_SNAPSHOT_VERSION;
  timestamp: number;
  uma1: IRunnerState;
  uma2: IRunnerState;
  courseId: number;
  racedef: RaceConditions;
  seed: number | null;
  nsamples: number;
  compareMode: CompareMode;
  fieldComposition: FieldComposition;
  witVarianceSettings: WitVarianceSettings;
  staminaDrainOverrides: StaminaDrainOverrides;
  forcedPositions: {
    uma1: Record<string, number>;
    uma2: Record<string, number>;
  };
  injectedDebuffs: InjectedDebuffsMap;
  scenarioOverrides?: ScenarioOverridesMap;
};
