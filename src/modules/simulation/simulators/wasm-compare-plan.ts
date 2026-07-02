// Main-thread builder for the WASM compare plan. This is the data-dependent
// half of the compare path (skill resolution, group sort, uma display names):
// it converts the app's `CompareParams` into a fully-resolved, structured-clone
// safe `ComparePlan` the worker runs without touching the dataset.

import type { CompareParams } from '@/modules/simulation/types';
import type { IRunnerState } from '@/modules/runners/components/runner-card/types';
import {
  compareParamsToWasm,
  contestedCompareParamsToWasm
} from '@/lib/uma-sim-wasm/adapter-params';
import { getUmaDisplayInfo } from '@/modules/runners/utils';
import { MAX_RUNNERS } from '@/store/runners.store';
import { createSkillSorterByGroup } from './shared';
import {
  DEFAULT_DUELING_RATES,
  createCompareSettings,
  toCreateRunner,
  toSundayRaceParameters
} from './shared-pure';
import type { ComparePlan } from './wasm-compare';

export type ComparePlanMode = ComparePlan['mode'];

export type BuildComparePlanOptions = {
  mode?: ComparePlanMode;
  /**
   * Target field size (total gates, contested mode only). Real umas fill
   * first; remaining gates are padded with generated 600-stat mobs.
   */
  fieldSize?: number;
  /** Extra field runners beyond the compared pair (context / opponents). */
  contextRunners?: Array<IRunnerState>;
};

/**
 * Compute the engine mob-fill target for `runnerCount` real umas and the
 * user's target `fieldSize`. `undefined` when the real field already meets or
 * exceeds the target (no padding).
 */
export function computeFillTo(runnerCount: number, fieldSize: number): number | undefined {
  const target = Math.min(MAX_RUNNERS, fieldSize);
  if (target <= runnerCount) return undefined;
  return target;
}

function resolveRunnerName(outfitId: string, fallbackIndex: number): string {
  const info = outfitId ? getUmaDisplayInfo(outfitId) : null;
  return info?.name ?? `Runner ${fallbackIndex + 1}`;
}

/** Resolve `CompareParams` into the data-free {@link ComparePlan} for the worker. */
export function buildComparePlan(
  params: CompareParams,
  buildOptions: BuildComparePlanOptions = {}
): ComparePlan {
  const {
    nsamples,
    course,
    racedef,
    uma1,
    uma2,
    options,
    forcedPositions,
    injectedDebuffs,
    scenarioOverrides
  } = params;

  const baseSeed = options.seed ?? 0;
  const mode = buildOptions.mode ?? 'vacuum';
  const fieldSize = buildOptions.fieldSize ?? 0;
  const contextRunners = buildOptions.contextRunners ?? [];
  const raceParameters = toSundayRaceParameters(racedef);

  const allSkillIds = [...uma1.skills, ...uma2.skills];
  const skillSorter = createSkillSorterByGroup(allSkillIds);
  const runnerASortedSkills = uma1.skills.toSorted(skillSorter);
  const runnerBSortedSkills = uma2.skills.toSorted(skillSorter);

  const settingsA = createCompareSettings({
    healthSystem: true,
    spotStruggle: true,
    sectionModifier: options.allowSectionModifierUma1,
    rushed: options.allowRushedUma1,
    downhill: options.allowDownhillUma1,
    conservePower: options.allowConservePowerUma1 ?? false,
    witChecks: options.skillCheckChanceUma1,
    staminaDrainOverrides: options.staminaDrainOverrides
  });
  const settingsB = createCompareSettings({
    healthSystem: true,
    spotStruggle: true,
    sectionModifier: options.allowSectionModifierUma2,
    rushed: options.allowRushedUma2,
    downhill: options.allowDownhillUma2,
    conservePower: options.allowConservePowerUma2 ?? false,
    witChecks: options.skillCheckChanceUma2,
    staminaDrainOverrides: options.staminaDrainOverrides
  });

  const runnerA = toCreateRunner(
    uma1,
    runnerASortedSkills,
    forcedPositions?.uma1,
    injectedDebuffs?.uma1,
    scenarioOverrides?.uma1
  );
  const runnerB = toCreateRunner(
    uma2,
    runnerBSortedSkills,
    forcedPositions?.uma2,
    injectedDebuffs?.uma2,
    scenarioOverrides?.uma2
  );

  if (mode === 'contested') {
    const settingsContested = createCompareSettings({
      healthSystem: true,
      spotStruggle: true,
      sectionModifier: options.allowSectionModifierUma1 || options.allowSectionModifierUma2,
      rushed: options.allowRushedUma1 || options.allowRushedUma2,
      downhill: options.allowDownhillUma1 || options.allowDownhillUma2,
      conservePower: Boolean(options.allowConservePowerUma1 || options.allowConservePowerUma2),
      witChecks: options.skillCheckChanceUma1 || options.skillCheckChanceUma2,
      staminaDrainOverrides: options.staminaDrainOverrides
    });

    // Context runners fill the field after the compared pair. Insertion order is
    // load-bearing: the trace split in `wasm-compare.ts` assumes A=id0, B=id1.
    const contextCreateRunners = contextRunners.map((runner) =>
      toCreateRunner(runner, runner.skills.toSorted(skillSorter))
    );
    const runnerCount = 2 + contextCreateRunners.length;

    return {
      mode: 'contested',
      wasmParamsContested: contestedCompareParamsToWasm({
        course,
        parameters: raceParameters,
        settings: settingsContested,
        runners: [runnerA, runnerB, ...contextCreateRunners],
        names: [
          resolveRunnerName(runnerA.outfitId, 0),
          resolveRunnerName(runnerB.outfitId, 1),
          ...contextCreateRunners.map((runner, index) => resolveRunnerName(runner.outfitId, index + 2))
        ],
        fillTo: computeFillTo(runnerCount, fieldSize),
        nsamples,
        masterSeed: baseSeed
      }),
      nsamples,
      baseSeed
    };
  }

  const wasmParamsA = compareParamsToWasm({
    course,
    parameters: raceParameters,
    settings: settingsA,
    duelingRates: DEFAULT_DUELING_RATES,
    runner: runnerA,
    name: resolveRunnerName(runnerA.outfitId, 0),
    nsamples,
    masterSeed: baseSeed
  });
  const wasmParamsB = compareParamsToWasm({
    course,
    parameters: raceParameters,
    settings: settingsB,
    duelingRates: DEFAULT_DUELING_RATES,
    runner: runnerB,
    name: resolveRunnerName(runnerB.outfitId, 1),
    nsamples,
    masterSeed: baseSeed
  });

  return { mode: 'vacuum', wasmParamsA, wasmParamsB, nsamples, baseSeed };
}
