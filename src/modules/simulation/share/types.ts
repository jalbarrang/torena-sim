import type { IRunnerState } from '@/modules/runners/components/runner-card/domain/runner-state';
import type { WitVarianceSettings, StaminaDrainOverrides } from '@/store/settings.store';
import type { RaceConditions } from '@/utils/races';
import type { InjectedDebuffsMap, ScenarioOverridesMap } from '@/modules/simulation/types';
import type { CompareMode } from '@/modules/simulation/stores/compare.store';

export const SIMULATION_SNAPSHOT_VERSION = 2 as const;

/**
 * Simulation snapshot, codec v2. The field is a runner array (2..=12) plus the
 * two compare-pair indices. Pair-scoped data (forced positions, injected
 * debuffs, scenario overrides) stays keyed by role (`uma1` = slot A, `uma2` =
 * slot B). The v2 decoder in `snapshot.ts` also accepts the v1 (`uma1`/`uma2` +
 * `fieldComposition`) and pre-versioned legacy shapes.
 */
export type SimulationSnapshot = {
  version: typeof SIMULATION_SNAPSHOT_VERSION;
  timestamp: number;
  runners: Array<IRunnerState>;
  /** Index into {@link runners} for compare slot A. */
  compareA: number;
  /** Index into {@link runners} for compare slot B. */
  compareB: number;
  courseId: number;
  racedef: RaceConditions;
  seed: number | null;
  nsamples: number;
  compareMode: CompareMode;
  /** True when a legacy pre-mode snapshot was coerced to contested + 2-field on decode. */
  coercedFromVacuum?: boolean;
  /** Target field size (total gates); real umas fill first, mobs pad the rest. */
  fieldSize: number;
  witVarianceSettings: WitVarianceSettings;
  staminaDrainOverrides: StaminaDrainOverrides;
  forcedPositions: {
    uma1: Record<string, number>;
    uma2: Record<string, number>;
  };
  injectedDebuffs: InjectedDebuffsMap;
  scenarioOverrides?: ScenarioOverridesMap;
};
