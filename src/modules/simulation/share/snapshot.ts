import { cloneDeep } from 'es-toolkit';
import { toast } from 'sonner';
import { replaceField, useRunnersStore, type FieldRunner } from '@/store/runners.store';
import { useSettingsStore } from '@/store/settings.store';
import {
  clampFieldSize,
  DEFAULT_FIELD_SIZE,
  MIN_FIELD_SIZE,
  resetResults,
  setCompareMode,
  setFieldSize,
  useRaceStore,
  type CompareMode
} from '@/modules/simulation/stores/compare.store';
import { useForcedPositionsStore } from '@/modules/simulation/stores/forced-positions.store';
import { useScenarioOverridesStore } from '@/modules/simulation/stores/scenario-overrides.store';
import { createRunnerState } from '@/modules/runners/components/runner-card/domain/runner-state';
import type { IRunnerState } from '@/modules/runners/components/runner-card/domain/runner-state';
import type { SimulationSnapshot } from './types';
import { SIMULATION_SNAPSHOT_VERSION } from './types';

function stripFieldId(runner: FieldRunner): IRunnerState {
  const { fieldId: _fieldId, ...rest } = cloneDeep(runner);
  return rest;
}

function buildSnapshot(): SimulationSnapshot {
  const runnersState = useRunnersStore.getState();
  const settings = useSettingsStore.getState();
  const race = useRaceStore.getState();
  const forced = useForcedPositionsStore.getState();
  const scenarioOverrides = useScenarioOverridesStore.getState();

  const runners = runnersState.runners.map(stripFieldId);
  const compareA = Math.max(
    0,
    runnersState.runners.findIndex((r) => r.fieldId === runnersState.compareA)
  );
  const compareB = Math.max(
    0,
    runnersState.runners.findIndex((r) => r.fieldId === runnersState.compareB)
  );

  return {
    version: SIMULATION_SNAPSHOT_VERSION,
    timestamp: Date.now(),
    runners,
    compareA,
    compareB,
    courseId: settings.courseId,
    racedef: cloneDeep(settings.racedef),
    seed: race.seed,
    nsamples: settings.nsamples,
    compareMode: race.compareMode,
    fieldSize: race.fieldSize,
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

function isRunnerState(value: unknown): value is IRunnerState {
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

/** Validate the parts of a snapshot that are identical across codec versions. */
function parseCommonFields(
  parsed: Record<string, unknown>
): Omit<
  SimulationSnapshot,
  'version' | 'runners' | 'compareA' | 'compareB' | 'compareMode' | 'fieldSize'
> | null {
  if (typeof parsed.timestamp !== 'number') return null;
  if (typeof parsed.courseId !== 'number') return null;
  if (!isRaceConditions(parsed.racedef)) return null;
  if (parsed.seed !== null && typeof parsed.seed !== 'number') return null;
  if (typeof parsed.nsamples !== 'number') return null;
  if (!isWitVariance(parsed.witVarianceSettings)) return null;
  if (!isRecord(parsed.staminaDrainOverrides)) return null;
  const fp = parsed.forcedPositions;
  if (!isRecord(fp) || !isRecord(fp.uma1) || !isRecord(fp.uma2)) return null;
  const fpNums = (o: Record<string, unknown>) =>
    Object.values(o).every((v) => typeof v === 'number');
  if (!fpNums(fp.uma1) || !fpNums(fp.uma2)) return null;
  if (!isInjectedDebuffsMap(parsed.injectedDebuffs)) return null;

  return {
    timestamp: parsed.timestamp,
    courseId: parsed.courseId,
    racedef: parsed.racedef as SimulationSnapshot['racedef'],
    seed: parsed.seed as number | null,
    nsamples: parsed.nsamples,
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

/** Decode the v2 (runner array) shape. */
function parseV2(parsed: Record<string, unknown>): SimulationSnapshot | null {
  const common = parseCommonFields(parsed);
  if (!common) return null;

  if (!Array.isArray(parsed.runners)) return null;
  if (!parsed.runners.every(isRunnerState)) return null;
  const runners = parsed.runners as Array<IRunnerState>;
  if (runners.length < 2 || runners.length > 12) return null;

  const compareA = parsed.compareA;
  const compareB = parsed.compareB;
  if (typeof compareA !== 'number' || typeof compareB !== 'number') return null;
  if (compareA < 0 || compareA >= runners.length) return null;
  if (compareB < 0 || compareB >= runners.length) return null;
  if (compareA === compareB) return null;

  if (parsed.compareMode !== undefined && !isCompareMode(parsed.compareMode)) return null;

  // v2 snapshots without `compareMode` predate the mode field, so import them as contested head-to-head with no mob fill and surface the compatibility warning. Explicit modes preserve their original behavior.
  const coercedFromVacuum = parsed.compareMode === undefined;
  const compareMode: CompareMode = isCompareMode(parsed.compareMode)
    ? parsed.compareMode
    : 'contested';
  // Vacuum ignores field size (no mob fill), so the shared value passes through untouched.
  const fieldSize = coercedFromVacuum
    ? MIN_FIELD_SIZE
    : typeof parsed.fieldSize === 'number'
      ? clampFieldSize(parsed.fieldSize)
      : typeof parsed.fillWithMobs === 'boolean'
        ? parsed.fillWithMobs
          ? DEFAULT_FIELD_SIZE
          : MIN_FIELD_SIZE
        : DEFAULT_FIELD_SIZE;

  return {
    version: SIMULATION_SNAPSHOT_VERSION,
    ...common,
    runners,
    compareA,
    compareB,
    compareMode,
    coercedFromVacuum: coercedFromVacuum || undefined,
    fieldSize
  };
}

/** Decode the legacy `{ uma1, uma2 }` pair shape (v1 and pre-versioned). */
function parseLegacyPair(parsed: Record<string, unknown>): SimulationSnapshot | null {
  const common = parseCommonFields(parsed);
  if (!common) return null;
  if (!isRunnerState(parsed.uma1)) return null;
  if (parsed.compareMode !== undefined && !isCompareMode(parsed.compareMode)) return null;

  const uma1 = parsed.uma1 as IRunnerState;
  const uma2 = isRunnerState(parsed.uma2) ? (parsed.uma2 as IRunnerState) : createRunnerState();

  // Pair snapshots without `compareMode` predate the mode field. Preserve explicit v1 modes; legacy pre-mode pairs become contested duo shares.
  const coercedFromVacuum = parsed.compareMode === undefined;
  const compareMode: CompareMode = isCompareMode(parsed.compareMode)
    ? parsed.compareMode
    : 'contested';
  const fieldSize =
    coercedFromVacuum || parsed.fieldComposition === 'duo' ? MIN_FIELD_SIZE : DEFAULT_FIELD_SIZE;

  return {
    version: SIMULATION_SNAPSHOT_VERSION,
    ...common,
    runners: [uma1, uma2],
    compareA: 0,
    compareB: 1,
    compareMode,
    coercedFromVacuum: coercedFromVacuum || undefined,
    fieldSize
  };
}

export function parseSnapshotJson(raw: string): SimulationSnapshot | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;

  const version = parsed.version;

  if (version === 2) {
    return parseV2(parsed);
  }
  if (version === 1) {
    return parseLegacyPair(parsed);
  }
  if (version === undefined) {
    return parseLegacyPair(parsed);
  }
  // Unknown / future version — refuse rather than silently mis-decode.
  return null;
}

export function importSnapshot(data: SimulationSnapshot): void {
  replaceField(data.runners, data.compareA, data.compareB);

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
    injectedDebuffs: cloneDeep(data.injectedDebuffs)
  });
  setFieldSize(data.fieldSize);
  setCompareMode(data.compareMode);

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
