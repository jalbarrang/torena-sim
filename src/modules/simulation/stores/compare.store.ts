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

const COMPARE_DEBUFFS_STORE_NAME = 'umalator-compare-debuffs';

export type CompareMode = 'contested' | 'vacuum';
export type FieldComposition = 'duo' | 'mobs';

export const DEFAULT_COMPARE_MODE: CompareMode = 'contested';
export const DEFAULT_FIELD_COMPOSITION: FieldComposition = 'duo';

const isCompareMode = (value: unknown): value is CompareMode => {
  return value === 'contested' || value === 'vacuum';
};

const isFieldComposition = (value: unknown): value is FieldComposition => {
  return value === 'duo' || value === 'mobs';
};

type PersistedRaceStore = {
  injectedDebuffs?: InjectedDebuffsMap;
  compareMode?: CompareMode;
  fieldComposition?: FieldComposition;
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
  fieldComposition: FieldComposition;
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
      fieldComposition: DEFAULT_FIELD_COMPOSITION
    }),
    {
      name: COMPARE_DEBUFFS_STORE_NAME,
      storage: createJSONStorage(() => localStorage),
      version: 1,
      migrate: (persistedState) => {
        const state = persistedState as PersistedRaceStore;

        return {
          injectedDebuffs: state.injectedDebuffs ?? { uma1: [], uma2: [] },
          compareMode: isCompareMode(state.compareMode) ? state.compareMode : DEFAULT_COMPARE_MODE,
          fieldComposition: isFieldComposition(state.fieldComposition)
            ? state.fieldComposition
            : DEFAULT_FIELD_COMPOSITION
        } satisfies PersistedRaceStore;
      },
      partialize: (state) => ({
        injectedDebuffs: state.injectedDebuffs,
        compareMode: state.compareMode,
        fieldComposition: state.fieldComposition
      })
    }
  )
);

export const setCompareSeed = (seed: number | null) => {
  useRaceStore.setState({ seed });
};

export const setCompareMode = (compareMode: CompareMode) => {
  useRaceStore.setState({ compareMode });
};

export const setFieldComposition = (fieldComposition: FieldComposition) => {
  useRaceStore.setState({ fieldComposition });
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
      fieldComposition: state.fieldComposition
    }))
  );
};
