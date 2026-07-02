import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useShallow } from 'zustand/shallow';
import type {
  CompareResult,
  CompareRunnerId,
  FirstUMAStats,
  SimulationData,
  SimulationRun,
  StaminaStats,
  Stats
} from '@/modules/simulation/compare.types';
import type { InjectedDebuffsMap } from '@/modules/simulation/types';
import { generateSeed } from '@/utils/crypto';
import { SpurtCandidate } from '@/lib/uma-domain/race/spurt-calculator';
import { MIN_RUNNERS, useRunnersStore } from '@/store/runners.store';

const COMPARE_DEBUFFS_STORE_NAME = 'umalator-compare-debuffs';

export type CompareMode = 'contested' | 'vacuum';

export const DEFAULT_COMPARE_MODE: CompareMode = 'contested';
// Padding the field with generated mobs is the default: the field-composition
// experiment (docs/dev-process/spike-contested-compare.md) showed an unpadded
// duo fails to surface spot-struggle / dueling for asymmetric fields — the exact
// mechanics contested compare exists to model.
export const DEFAULT_FILL_WITH_MOBS = true;

const isCompareMode = (value: unknown): value is CompareMode => {
  return value === 'contested' || value === 'vacuum';
};

/** Vacuum mode compares two isolated runners; it is only valid for a duo field. */
export const canUseVacuum = (fieldSize: number): boolean => fieldSize <= MIN_RUNNERS;

type PersistedRaceStore = {
  injectedDebuffs?: InjectedDebuffsMap;
  compareMode?: CompareMode;
  fillWithMobs?: boolean;
};

type IRaceStore = {
  seed: number | null;
  results: Array<number>;
  runData: SimulationData | null;
  chartData: SimulationRun | null;
  displaying: string;
  rushedStats: Stats | null;
  fullyChargedStats: Stats | null;
  leadCompetitionStats: Stats | null;
  spurtInfo: SpurtCandidate | null;
  staminaStats: StaminaStats | null;
  firstUmaStats: FirstUMAStats | null;
  isSimulationRunning: boolean;
  simulationProgress: { current: number; total: number } | null;
  injectedDebuffs: InjectedDebuffsMap;
  compareMode: CompareMode;
  fillWithMobs: boolean;
};

export const useRaceStore = create<IRaceStore>()(
  persist(
    (_) => ({
      seed: null,
      results: [],
      runData: null,
      chartData: null,
      displaying: 'meanrun',
      rushedStats: null,
      fullyChargedStats: null,
      leadCompetitionStats: null,
      spurtInfo: null,
      staminaStats: null,
      firstUmaStats: null,
      isSimulationRunning: false,
      simulationProgress: null,
      injectedDebuffs: { uma1: [], uma2: [] },
      compareMode: DEFAULT_COMPARE_MODE,
      fillWithMobs: DEFAULT_FILL_WITH_MOBS
    }),
    {
      name: COMPARE_DEBUFFS_STORE_NAME,
      storage: createJSONStorage(() => localStorage),
      version: 2,
      migrate: (persistedState, version) => migrateComparePersisted(persistedState, version),
      partialize: (state) => ({
        injectedDebuffs: state.injectedDebuffs,
        compareMode: state.compareMode,
        fillWithMobs: state.fillWithMobs
      })
    }
  )
);

/** Persist migration for the compare store (exported for unit tests). */
export const migrateComparePersisted = (
  persistedState: unknown,
  version: number
): PersistedRaceStore => {
  const state = (persistedState ?? {}) as PersistedRaceStore & { fieldComposition?: string };

  // v1 stored `fieldComposition: 'duo' | 'mobs'`; map it to `fillWithMobs`.
  const fillWithMobs =
    version >= 2
      ? (state.fillWithMobs ?? DEFAULT_FILL_WITH_MOBS)
      : state.fieldComposition === undefined
        ? DEFAULT_FILL_WITH_MOBS
        : state.fieldComposition === 'mobs';

  return {
    injectedDebuffs: state.injectedDebuffs ?? { uma1: [], uma2: [] },
    compareMode: isCompareMode(state.compareMode) ? state.compareMode : DEFAULT_COMPARE_MODE,
    fillWithMobs
  } satisfies PersistedRaceStore;
};

export const setCompareSeed = (seed: number | null) => {
  useRaceStore.setState({ seed });
};

export const setCompareMode = (compareMode: CompareMode) => {
  // Vacuum is only valid for a duo field; growing the field forces contested.
  if (compareMode === 'vacuum' && !canUseVacuum(useRunnersStore.getState().runners.length)) {
    return;
  }
  useRaceStore.setState({ compareMode });
};

/** Force contested compare — called by the runners store when the field grows past a duo. */
export const forceContestedForField = () => {
  useRaceStore.setState({ compareMode: 'contested' });
};

export const setFillWithMobs = (fillWithMobs: boolean) => {
  useRaceStore.setState({ fillWithMobs });
};

export const createNewCompareSeed = () => {
  const seed = generateSeed();
  useRaceStore.setState({ seed });

  return seed;
};

export const setResults = (results: CompareResult) => {
  const { displaying = 'meanrun' } = useRaceStore.getState();

  const currentRunData = results.runData[displaying as keyof SimulationData];

  useRaceStore.setState({
    results: results.results,
    runData: results.runData,
    chartData: currentRunData,
    displaying: displaying,
    rushedStats: results.rushedStats,
    fullyChargedStats: results.fullyChargedStats,
    leadCompetitionStats: results.leadCompetitionStats,
    spurtInfo: results.spurtInfo ?? undefined,
    staminaStats: results.staminaStats,
    firstUmaStats: results.firstUmaStats
  });
};

export const setDisplaying = (displaying: string = 'meanrun') => {
  const { runData } = useRaceStore.getState();

  const currentRunData = runData?.[displaying as keyof SimulationData];

  useRaceStore.setState({
    displaying,
    chartData: currentRunData
  });
};

export const resetResults = () => {
  useRaceStore.setState({
    results: [],
    runData: null,
    chartData: null,
    displaying: 'meanrun',
    rushedStats: null,
    fullyChargedStats: null,
    leadCompetitionStats: null,
    spurtInfo: null,
    staminaStats: null,
    firstUmaStats: null,
    simulationProgress: null
  });
};

export const setIsCompareSimRunning = (isSimulationRunning: boolean) => {
  useRaceStore.setState({ isSimulationRunning });
};

export const setSimulationProgress = (progress: { current: number; total: number } | null) => {
  useRaceStore.setState({ simulationProgress: progress });
};

export const addDebuff = (runnerId: CompareRunnerId, skillId: string, position: number) => {
  useRaceStore.setState((state) => ({
    injectedDebuffs: {
      ...state.injectedDebuffs,
      [runnerId]: [
        ...state.injectedDebuffs[runnerId],
        { id: crypto.randomUUID(), skillId, position: Math.round(position) }
      ]
    }
  }));
};

export const removeDebuff = (runnerId: CompareRunnerId, debuffId: string) => {
  useRaceStore.setState((state) => ({
    injectedDebuffs: {
      ...state.injectedDebuffs,
      [runnerId]: state.injectedDebuffs[runnerId].filter((debuff) => debuff.id !== debuffId)
    }
  }));
};

export const updateDebuffPosition = (
  runnerId: CompareRunnerId,
  debuffId: string,
  position: number
) => {
  const normalizedPosition = Math.round(position);

  useRaceStore.setState((state) => {
    let changed = false;

    const nextRunnerDebuffs = state.injectedDebuffs[runnerId].map((debuff) => {
      if (debuff.id !== debuffId) {
        return debuff;
      }

      if (debuff.position === normalizedPosition) {
        return debuff;
      }

      changed = true;
      return { ...debuff, position: normalizedPosition };
    });

    if (!changed) {
      return state;
    }

    return {
      injectedDebuffs: {
        ...state.injectedDebuffs,
        [runnerId]: nextRunnerDebuffs
      }
    };
  });
};

export const clearAllDebuffs = () => {
  useRaceStore.setState({ injectedDebuffs: { uma1: [], uma2: [] } });
};

export const useDebuffs = (): InjectedDebuffsMap => {
  return useRaceStore(
    useShallow((state) => ({
      uma1: state.injectedDebuffs.uma1,
      uma2: state.injectedDebuffs.uma2
    }))
  );
};

export const useCompareSettings = () => {
  return useRaceStore(
    useShallow((state) => ({
      compareMode: state.compareMode,
      fillWithMobs: state.fillWithMobs
    }))
  );
};
