import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useShallow } from 'zustand/shallow';
import type { IRunnerState } from '@/modules/runners/components/runner-card/domain/runner-state';
import type { RaceConditions } from '@/utils/races';
import { createRunnerState } from '@/modules/runners/components/runner-card/domain/runner-state';
import { DEFAULT_SAMPLES } from '@/utils/constants';
import { getDefaultCourseId } from '@/store/race/defaults';
import { createRaceConditions } from '@/utils/races';
import {
  defaultRaceTrackDisplaySettings,
  migrateRaceTrackDisplaySettings,
  type RaceTrackDisplaySettings
} from '@/modules/racetrack/display-settings';

export type WitVarianceSettings = {
  allowRushedUma1: boolean;
  allowRushedUma2: boolean;
  allowDownhillUma1: boolean;
  allowDownhillUma2: boolean;
  allowConservePowerUma1: boolean;
  allowConservePowerUma2: boolean;
  allowSectionModifierUma1: boolean;
  allowSectionModifierUma2: boolean;
  allowSkillCheckChanceUma1: boolean;
  allowSkillCheckChanceUma2: boolean;
  simWitVariance: boolean;
};

export type StaminaDrainOverrides = Record<string, number>;

type ISettingsStore = {
  courseId: number;
  nsamples: number;
  racedef: RaceConditions;
  uma1: IRunnerState;
  uma2: IRunnerState;
  witVarianceSettings: WitVarianceSettings;
  staminaDrainOverrides: StaminaDrainOverrides;
  selectedPresetId: string | null;
} & RaceTrackDisplaySettings;

export const useSettingsStore = create<ISettingsStore>()(
  persist(
    (_) => ({
      courseId: getDefaultCourseId(),
      nsamples: DEFAULT_SAMPLES,
      racedef: createRaceConditions(),
      uma1: createRunnerState(),
      uma2: createRunnerState(),
      witVarianceSettings: {
        allowRushedUma1: true,
        allowRushedUma2: true,
        allowDownhillUma1: true,
        allowDownhillUma2: true,
        allowConservePowerUma1: true,
        allowConservePowerUma2: true,
        allowSectionModifierUma1: true,
        allowSectionModifierUma2: true,
        allowSkillCheckChanceUma1: true,
        allowSkillCheckChanceUma2: true,
        simWitVariance: true
      },
      staminaDrainOverrides: {},
      selectedPresetId: null,

      ...defaultRaceTrackDisplaySettings()
    }),
    {
      name: 'umalator-settings',
      storage: createJSONStorage(() => localStorage),
      version: 3,
      migrate: (persistedState, version) => {
        const migrated =
          version < 2
            ? {
                ...(persistedState as object),
                ...migrateRaceTrackDisplaySettings(
                  persistedState as Parameters<typeof migrateRaceTrackDisplaySettings>[0]
                )
              }
            : (persistedState as ISettingsStore);

        if (version < 3) {
          const state = migrated as ISettingsStore;
          return {
            ...state,
            witVarianceSettings: {
              ...state.witVarianceSettings,
              allowConservePowerUma1: state.witVarianceSettings.allowConservePowerUma1 ?? true,
              allowConservePowerUma2: state.witVarianceSettings.allowConservePowerUma2 ?? true
            }
          } satisfies ISettingsStore;
        }
        return migrated as ISettingsStore;
      }
    }
  )
);

export const useWitVariance = () =>
  useSettingsStore(useShallow((state) => state.witVarianceSettings));

const getWitVariance = () => useSettingsStore.getState().witVarianceSettings;

export const setWitVariance = (witVarianceSettings: Partial<WitVarianceSettings>) => {
  useSettingsStore.setState((state) => ({
    witVarianceSettings: {
      ...state.witVarianceSettings,
      ...witVarianceSettings
    }
  }));
};

export const useStaminaDrainOverrides = () =>
  useSettingsStore(useShallow((state) => state.staminaDrainOverrides));

export const setStaminaDrainOverride = (skillId: string, value: number | null) => {
  const normalizedSkillId = skillId.split('-', 1)[0] ?? skillId;
  useSettingsStore.setState((state) => {
    const nextOverrides = { ...state.staminaDrainOverrides };

    if (value === null) {
      delete nextOverrides[normalizedSkillId];
    } else {
      nextOverrides[normalizedSkillId] = value;
    }

    return { staminaDrainOverrides: nextOverrides };
  });
};

export const setSamples = (samples: number) => {
  useSettingsStore.setState({ nsamples: samples });
};

export const setRaceParams = (raceParams: RaceConditions) => {
  useSettingsStore.setState({ racedef: raceParams, selectedPresetId: null });
};

export const setCourseId = (courseId: number) => {
  useSettingsStore.setState({ courseId, selectedPresetId: null });
};

export const setSelectedPresetId = (presetId: string | null) => {
  useSettingsStore.setState({ selectedPresetId: presetId });
};

export const useRaceTrackDisplay = () =>
  useSettingsStore(
    useShallow((state) => ({
      showVelocityUma1: state.showVelocityUma1,
      showVelocityUma2: state.showVelocityUma2,
      showHpUma1: state.showHpUma1,
      showHpUma2: state.showHpUma2,
      showLanesUma1: state.showLanesUma1,
      showLanesUma2: state.showLanesUma2,
      showThresholdHalfway: state.showThresholdHalfway,
      showThreshold777: state.showThreshold777,
      showThreshold200: state.showThreshold200,
      showSkillMarkers: state.showSkillMarkers,
      showDebuffMarkers: state.showDebuffMarkers,
      showRushedMarkers: state.showRushedMarkers,
      showFullyChargedMarkers: state.showFullyChargedMarkers,
      showScenarioMarkers: state.showScenarioMarkers,
      showPosKeepLabels: state.showPosKeepLabels
    }))
  );

const setRaceTrackDisplay = (partial: Partial<RaceTrackDisplaySettings>) => {
  useSettingsStore.setState(partial);
};

export const toggleRaceTrackDisplay = (key: keyof RaceTrackDisplaySettings) => {
  useSettingsStore.setState((state) => ({ [key]: !state[key] }));
};

/** @deprecated Use useRaceTrackDisplay instead */
const useRaceTrackUI = useRaceTrackDisplay;
