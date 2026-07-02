import { cloneDeep } from 'es-toolkit';
import { toast } from 'sonner';
import { useRunnersStore } from '@/store/runners.store';
import { useSettingsStore } from '@/store/settings.store';
import {
  DEFAULT_FIELD_COMPOSITION,
  resetResults,
  useRaceStore,
  type CompareMode,
  type FieldComposition
} from '@/modules/simulation/stores/compare.store';
import { useForcedPositionsStore } from '@/modules/simulation/stores/forced-positions.store';
import { useScenarioOverridesStore } from '@/modules/simulation/stores/scenario-overrides.store';
import { createRunnerState } from '@/modules/runners/components/runner-card/types';
import type { SimulationSnapshot } from './types';
import { SIMULATION_SNAPSHOT_VERSION } from './types';

function buildSnapshot(): SimulationSnapshot {
  const runners = useRunnersStore.getState();
  const settings = useSettingsStore.getState();
  const race = useRaceStore.getState();
  const forced = useForcedPositionsStore.getState();
  const scenarioOverrides = useScenarioOverridesStore.getState();

  return {
    version: SIMULATION_SNAPSHOT_VERSION,
    timestamp: Date.now(),
    uma1: cloneDeep(runners.uma1),
    uma2: cloneDeep(runners.uma2),
    courseId: settings.courseId,
    racedef: cloneDeep(settings.racedef),
    seed: race.seed,
    nsamples: settings.nsamples,
    compareMode: race.compareMode,
    fieldComposition: race.fieldComposition,
    witVarianceSettings: cloneDeep(settings.witVarianceSettings),
    staminaDrainOverrides: cloneDeep(settings.staminaDrainOverrides),
    forcedPositions: {
      uma1: cloneDeep(forced.uma1),
      uma2: cloneDeep(forced.uma2)
    },
    injectedDebuffs: cloneDeep(race.injectedDebuffs),
    scenarioOverrides: cloneDeep({
      uma1: scenarioOverrides.uma1,
      uma2: scenarioOverrides.uma2
    })
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRunnerState(value: unknown): value is SimulationSnapshot['uma1'] {
  if (!isRecord(value)) return false;
  return (
    typeof value.outfitId === 'string' &&
    typeof value.speed === 'number' &&
    typeof value.stamina === 'number' &&
    typeof value.power === 'number' &&
    typeof value.guts === 'number' &&
    typeof value.wisdom === 'number' &&
    typeof value.strategy === 'string' &&
    typeof value.distanceAptitude === 'string' &&
    typeof value.surfaceAptitude === 'string' &&
    typeof value.strategyAptitude === 'string' &&
    typeof value.mood === 'number' &&
    Array.isArray(value.skills)
  );
}

function isRaceConditions(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.mood === 'number' &&
    typeof value.ground === 'number' &&
    typeof value.weather === 'number' &&
    typeof value.season === 'number' &&
    typeof value.time === 'number' &&
    typeof value.grade === 'number'
  );
}

function isCompareMode(value: unknown): value is CompareMode {
  return value === 'contested' || value === 'vacuum';
}

function isFieldComposition(value: unknown): value is FieldComposition {
  return value === 'duo' || value === 'mobs';
}

function isWitVariance(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const keys = [
    'allowRushedUma1',
    'allowRushedUma2',
    'allowDownhillUma1',
    'allowDownhillUma2',
    'allowConservePowerUma1',
    'allowConservePowerUma2',
    'allowSectionModifierUma1',
    'allowSectionModifierUma2',
    'allowSkillCheckChanceUma1',
    'allowSkillCheckChanceUma2',
    'simWitVariance'
  ] as const;
  return keys.every((k) => typeof value[k] === 'boolean');
}

function isInjectedDebuffsMap(value: unknown): value is SimulationSnapshot['injectedDebuffs'] {
  if (!isRecord(value)) return false;
  const u1 = value.uma1;
  const u2 = value.uma2;
  if (!Array.isArray(u1) || !Array.isArray(u2)) return false;
  const ok = (arr: unknown[]) =>
    arr.every(
      (d) =>
        isRecord(d) &&
        typeof d.id === 'string' &&
        typeof d.skillId === 'string' &&
        typeof d.position === 'number'
    );
  return ok(u1) && ok(u2);
}

export function parseSnapshotJson(raw: string): SimulationSnapshot | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;
  if (parsed.version !== SIMULATION_SNAPSHOT_VERSION) return null;
  if (typeof parsed.timestamp !== 'number') return null;
  if (!isRunnerState(parsed.uma1)) return null;
  const uma2 = parsed.uma2;
  if (uma2 !== undefined && !isRunnerState(uma2)) return null;
  if (typeof parsed.courseId !== 'number') return null;
  if (!isRaceConditions(parsed.racedef)) return null;
  if (parsed.seed !== null && typeof parsed.seed !== 'number') return null;
  if (typeof parsed.nsamples !== 'number') return null;
  const compareMode = parsed.compareMode === undefined ? 'vacuum' : parsed.compareMode;
  if (!isCompareMode(compareMode)) return null;
  const fieldComposition =
    parsed.fieldComposition === undefined ? DEFAULT_FIELD_COMPOSITION : parsed.fieldComposition;
  if (!isFieldComposition(fieldComposition)) return null;
  if (!isWitVariance(parsed.witVarianceSettings)) return null;
  if (!isRecord(parsed.staminaDrainOverrides)) return null;
  const fp = parsed.forcedPositions;
  if (!isRecord(fp) || !isRecord(fp.uma1) || !isRecord(fp.uma2)) return null;
  const fpNums = (o: Record<string, unknown>) =>
    Object.values(o).every((v) => typeof v === 'number');
  if (!fpNums(fp.uma1) || !fpNums(fp.uma2)) return null;
  if (!isInjectedDebuffsMap(parsed.injectedDebuffs)) return null;

  const uma2Resolved = isRunnerState(parsed.uma2) ? parsed.uma2 : createRunnerState();

  return {
    version: SIMULATION_SNAPSHOT_VERSION,
    timestamp: parsed.timestamp,
    uma1: parsed.uma1,
    uma2: uma2Resolved,
    courseId: parsed.courseId,
    racedef: parsed.racedef as SimulationSnapshot['racedef'],
    seed: parsed.seed,
    nsamples: parsed.nsamples,
    compareMode,
    fieldComposition,
    witVarianceSettings: parsed.witVarianceSettings as SimulationSnapshot['witVarianceSettings'],
    staminaDrainOverrides:
      parsed.staminaDrainOverrides as SimulationSnapshot['staminaDrainOverrides'],
    forcedPositions: {
      uma1: fp.uma1 as Record<string, number>,
      uma2: fp.uma2 as Record<string, number>
    },
    injectedDebuffs: parsed.injectedDebuffs,
    scenarioOverrides: parsed.scenarioOverrides as SimulationSnapshot['scenarioOverrides']
  };
}

export function importSnapshot(data: SimulationSnapshot): void {
  const uma2 = data.uma2 ?? createRunnerState();

  useRunnersStore.setState({
    uma1: cloneDeep(data.uma1),
    uma2: cloneDeep(uma2)
  });

  useSettingsStore.setState({
    courseId: data.courseId,
    racedef: cloneDeep(data.racedef),
    nsamples: data.nsamples,
    witVarianceSettings: cloneDeep(data.witVarianceSettings),
    staminaDrainOverrides: cloneDeep(data.staminaDrainOverrides),
    selectedPresetId: null
  });

  useForcedPositionsStore.setState({
    uma1: cloneDeep(data.forcedPositions.uma1),
    uma2: cloneDeep(data.forcedPositions.uma2)
  });

  if (data.scenarioOverrides) {
    useScenarioOverridesStore.setState({
      uma1: cloneDeep(data.scenarioOverrides.uma1),
      uma2: cloneDeep(data.scenarioOverrides.uma2)
    });
  }

  useRaceStore.setState({
    seed: data.seed,
    compareMode: data.compareMode,
    fieldComposition: data.fieldComposition,
    injectedDebuffs: cloneDeep(data.injectedDebuffs)
  });

  resetResults();
}

export function downloadSnapshot(filename = 'umalator-simulation.json'): void {
  try {
    const snapshot = buildSnapshot();
    const json = JSON.stringify(snapshot, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Simulation settings exported');
  } catch {
    toast.error('Failed to export simulation settings');
  }
}
