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

// The user-facing "field size" (total gates). Real umas fill first; remaining
// gates are padded with generated 600-stat mobs. Default 9: the
// field-composition experiment (docs/dev-process/spike-contested-compare.md)
// showed an unpadded duo fails to surface spot-struggle / dueling for
// asymmetric fields — the exact mechanics contested compare exists to model.
export const DEFAULT_FIELD_SIZE = 9;
export const MIN_FIELD_SIZE = 2;
export const MAX_FIELD_SIZE = 12;

/** Clamp an arbitrary value into a valid field size. */
export const clampFieldSize = (value: number): number => {
  if (!Number.isFinite(value)) return DEFAULT_FIELD_SIZE;
  return Math.min(MAX_FIELD_SIZE, Math.max(MIN_FIELD_SIZE, Math.round(value)));
};

const isCompareMode = (value: unknown): value is CompareMode => {
  return value === 'contested' || value === 'vacuum';
};

/** Vacuum mode compares two isolated runners; it is only valid for a duo field. */
export const canUseVacuum = (fieldSize: number): boolean => fieldSize <= MIN_RUNNERS;

type PersistedRaceStore = {
  injectedDebuffs?: InjectedDebuffsMap;
  compareMode?: CompareMode;
  fieldSize?: number;
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
  duelingStats: Stats | null;
  spurtInfo: SpurtCandidate | null;
  staminaStats: StaminaStats | null;
  firstUmaStats: FirstUMAStats | null;
  isSimulationRunning: boolean;
  simulationProgress: { current: number; total: number } | null;
  injectedDebuffs: InjectedDebuffsMap;
  compareMode: CompareMode;
  fieldSize: number;
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
      duelingStats: null,
      spurtInfo: null,
      staminaStats: null,
      firstUmaStats: null,
      isSimulationRunning: false,
      simulationProgress: null,
      injectedDebuffs: { uma1: [], uma2: [] },
      compareMode: DEFAULT_COMPARE_MODE,
      fieldSize: DEFAULT_FIELD_SIZE
    }),
    {
      name: COMPARE_DEBUFFS_STORE_NAME,
      storage: createJSONStorage(() => localStorage),
      // v4 dropped `compareMode`; v5 reintroduces it with contested as the default.
      version: 5,
      migrate: (persistedState, version) => migrateComparePersisted(persistedState, version),
      partialize: (state) => ({
        injectedDebuffs: state.injectedDebuffs,
        compareMode: state.compareMode,
        fieldSize: state.fieldSize
      })
    }
  )
);

/** Persist migration for the compare store (exported for unit tests). */
export const migrateComparePersisted = (
  persistedState: unknown,
  version: number
): PersistedRaceStore => {
  const state = (persistedState ?? {}) as PersistedRaceStore & {
    fieldComposition?: string;
    fillWithMobs?: boolean;
  };

  // v1 stored `fieldComposition: 'duo' | 'mobs'`; v2 stored `fillWithMobs: boolean`; v3+ stores the explicit `fieldSize` (total gates). v4 dropped `compareMode`; v5 reintroduces it with contested as the default, so v4 and older persisted modes are ignored.
  let fieldSize: number;
  if (version >= 3) {
    fieldSize = clampFieldSize(state.fieldSize ?? DEFAULT_FIELD_SIZE);
  } else if (version === 2) {
    fieldSize = (state.fillWithMobs ?? true) ? DEFAULT_FIELD_SIZE : MIN_FIELD_SIZE;
  } else {
    fieldSize =
      state.fieldComposition === undefined || state.fieldComposition === 'mobs'
        ? DEFAULT_FIELD_SIZE
        : MIN_FIELD_SIZE;
  }

  return {
    injectedDebuffs: state.injectedDebuffs ?? { uma1: [], uma2: [] },
    compareMode:
      version <= 4
        ? DEFAULT_COMPARE_MODE
        : isCompareMode(state.compareMode)
          ? state.compareMode
          : DEFAULT_COMPARE_MODE,
    fieldSize
  } satisfies PersistedRaceStore;
};

export const setCompareSeed = (seed: number | null) => {
  useRaceStore.setState({ seed });
};

export const setCompareMode = (compareMode: CompareMode) => {
  if (compareMode === 'vacuum' && !canUseVacuum(useRunnersStore.getState().runners.length)) {
    return;
  }

  useRaceStore.setState({ compareMode });
};

export const forceContestedForField = () => {
  useRaceStore.setState({ compareMode: DEFAULT_COMPARE_MODE });
};

/** Startup reconciliation: vacuum is duo-only, but `compareMode` and the runner list persist in separate stores. An interrupted write (or storage tampering) can leave a persisted vacuum mode alongside a >2 field; fall back to contested. Runs once at module load, after both stores rehydrate synchronously (the runners store rehydrates first because this module imports it). Exported for unit tests. */
export const reconcileCompareModeWithField = () => {
  if (
    useRaceStore.getState().compareMode === 'vacuum' &&
    !canUseVacuum(useRunnersStore.getState().runners.length)
  ) {
    forceContestedForField();
  }
};

reconcileCompareModeWithField();

export const setFieldSize = (fieldSize: number) => {
  useRaceStore.setState({ fieldSize: clampFieldSize(fieldSize) });
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
    duelingStats: results.duelingStats,
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
    duelingStats: null,
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
      fieldSize: state.fieldSize
    }))
  );
};
