// WASM-backed skill-compare orchestration (Compare Skills / Compare Uniques).
// Mirrors `skill-compare.ts` but sources telemetry from the Rust `runCompare`
// read-model. Two vacuum races share a master seed: the baseline runner and the
// runner with the tracked skill added. The bashin-delta + tracked-skill meta
// reduction lives here on the TS side.

import type { SkillComparisonResponse } from '@/modules/simulation/types';
import type {
  SkillEffectLog,
  SkillSimulationData,
  SkillSimulationRun,
  SkillTrackedMeta,
  SkillTrackedMetaCollection
} from '@/modules/simulation/compare.types';
import type { CollectedRunnerRoundData } from '@/lib/uma-domain/race/race-observer';
import { initializeSkillSimulationRun } from '@/modules/simulation/compare.types';
import { SkillPerspective } from '@/lib/uma-domain/skills/definitions';
import { wasmCompareRoundDataToCollected } from '@/lib/uma-sim-wasm/adapter-results';
import { runCompare } from '@/lib/uma-sim-wasm/loader';
import type { WasmCompareData, WasmCompareParams } from '@/lib/uma-sim-wasm/types';
import type { SkillComparisonResult } from './skill-compare';
import { computePositionDiff, isSameSkill, type EffectMeta } from './shared-pure';

/**
 * One resolved skill-sampling unit: baseline + tracked-skill runners already
 * converted to WASM params on the main thread (via `buildSkillSamplingPlan` in
 * `wasm-skill-compare-plan.ts`), plus the precomputed fallback effect metadata.
 * The worker runs + reduces these without touching the dataset.
 */
export type SkillSamplingPlanEntry = {
  skillId: string;
  fallback: EffectMeta;
  nsamples: number;
  wasmParamsBaseline: WasmCompareParams;
  wasmParamsTracked: WasmCompareParams;
};

export type SkillSamplingPlan = {
  entries: Array<SkillSamplingPlanEntry>;
};

/** Tracked-skill activation logs for `trackedSkillId`, normalized to that id. */
function getTrackedLogs(
  roundB: CollectedRunnerRoundData,
  trackedSkillId: string
): Array<SkillEffectLog> {
  const matching: Array<SkillEffectLog> = [];
  for (const [skillId, logs] of Object.entries(roundB.skillActivations)) {
    if (!isSameSkill(skillId, trackedSkillId)) {
      continue;
    }
    for (const log of logs) {
      matching.push({ ...log, skillId: trackedSkillId });
    }
  }
  return matching;
}

function buildFallbackLogs(
  roundB: CollectedRunnerRoundData,
  trackedUsed: boolean,
  trackedSkillId: string,
  seed: number,
  fallback: EffectMeta
): Array<SkillEffectLog> {
  if (!trackedUsed) {
    return [];
  }
  const activationPosition =
    roundB.position.length > 0
      ? Math.min(roundB.position[roundB.position.length - 1], roundB.finishPosition)
      : roundB.finishPosition;
  return [
    {
      executionId: `${seed}-${roundB.runnerId}-fallback`,
      skillId: trackedSkillId,
      start: activationPosition,
      end: activationPosition,
      perspective: SkillPerspective.Self,
      effectType: fallback.effectType,
      effectTarget: fallback.effectTarget
    }
  ];
}

function extractUniquePositions(logs: Array<SkillEffectLog>): Array<number> {
  const positions: Array<number> = [];
  for (const log of logs) {
    const pos = log.start;
    const previous = positions[positions.length - 1];
    if (previous == null || Math.abs(previous - pos) > 1e-9) {
      positions.push(pos);
    }
  }
  return positions;
}

type SampleSummary = {
  basinn: number;
  data: SkillSimulationRun;
  trackedMeta: SkillTrackedMeta | null;
};

/**
 * Reduce one paired sample (baseline vs tracked) into its bashin delta,
 * representative-run payload, and optional tracked-skill meta.
 * Replicates `SkillCompareDataCollector.finalizeCurrentTrackedMeta`.
 */
function summarizeSample(
  roundA: WasmCompareData['rounds'][number] | undefined,
  roundB: WasmCompareData['rounds'][number] | undefined,
  trackedSkillId: string,
  fallback: EffectMeta
): SampleSummary {
  const baselinePrimary = roundA?.runners[0];
  const trackedPrimary = roundB?.runners[0];
  if (!baselinePrimary || !trackedPrimary || !roundB) {
    throw new Error('Missing collected runner data for skill comparison');
  }

  const baselinePosition = baselinePrimary.position;
  if (baselinePosition.length === 0) {
    throw new Error('Missing collected runner data for skill comparison');
  }

  const collectedB = wasmCompareRoundDataToCollected(trackedPrimary);
  const basinn = computePositionDiff(baselinePosition, collectedB.position) / 2.5;

  const trackedUsed = collectedB.usedSkills.some((usedSkillId) =>
    isSameSkill(usedSkillId, trackedSkillId)
  );
  const trackedLogs = getTrackedLogs(collectedB, trackedSkillId);
  const logs =
    trackedLogs.length > 0
      ? trackedLogs
      : buildFallbackLogs(collectedB, trackedUsed, trackedSkillId, roundB.seed, fallback);
  const positions = extractUniquePositions(logs);

  // Retained only for the 4 representative runs; references (not copies) of the
  // arrays already held by the WASM round payloads.
  const telemetry = {
    baseline: {
      time: baselinePrimary.time,
      position: baselinePrimary.position,
      velocity: baselinePrimary.velocity
    },
    tracked: {
      time: trackedPrimary.time,
      position: trackedPrimary.position,
      velocity: trackedPrimary.velocity
    }
  };

  const data: SkillSimulationRun =
    logs.length === 0
      ? initializeSkillSimulationRun({ telemetry })
      : { sk: [{}, { [trackedSkillId]: logs.map((log) => ({ ...log })) }], telemetry };

  const trackedMeta =
    trackedUsed || positions.length > 0 ? { horseLength: basinn, positions } : null;

  return { basinn, data, trackedMeta };
}

/**
 * Streams the running min/max plus the runs closest to the estimated mean and
 * median (estimated once `cutoff` samples are in). Retains only the four
 * representative {@link SkillSimulationRun}s instead of every sample's payload.
 */
class RepresentativeRunTracker {
  minrun: SkillSimulationRun = initializeSkillSimulationRun();
  maxrun: SkillSimulationRun = initializeSkillSimulationRun();
  meanrun: SkillSimulationRun = initializeSkillSimulationRun();
  medianrun: SkillSimulationRun = initializeSkillSimulationRun();

  private min = Infinity;
  private max = -Infinity;
  private estMean = 0;
  private estMedian = 0;
  private bestMeanDiff = Infinity;
  private bestMedianDiff = Infinity;

  constructor(private readonly cutoff: number) {}

  /** Observe one sample. `diffSoFar` must already include `basinn`. */
  observe(index: number, basinn: number, data: SkillSimulationRun, diffSoFar: Array<number>): void {
    if (basinn < this.min) {
      this.min = basinn;
      this.minrun = data;
    }
    if (basinn > this.max) {
      this.max = basinn;
      this.maxrun = data;
    }

    if (index === this.cutoff) {
      diffSoFar.sort((a, b) => a - b);
      this.estMean = diffSoFar.reduce((a, b) => a + b) / diffSoFar.length;
      const mid = Math.floor(diffSoFar.length / 2);
      this.estMedian =
        mid > 0 && diffSoFar.length % 2 === 0
          ? (diffSoFar[mid - 1] + diffSoFar[mid]) / 2
          : diffSoFar[mid];
    }

    if (index >= this.cutoff) {
      const meanDiff = Math.abs(basinn - this.estMean);
      const medianDiff = Math.abs(basinn - this.estMedian);
      if (meanDiff < this.bestMeanDiff) {
        this.bestMeanDiff = meanDiff;
        this.meanrun = data;
      }
      if (medianDiff < this.bestMedianDiff) {
        this.bestMedianDiff = medianDiff;
        this.medianrun = data;
      }
    }
  }

  toRunData(): SkillSimulationData {
    return {
      minrun: this.minrun,
      maxrun: this.maxrun,
      meanrun: this.meanrun,
      medianrun: this.medianrun
    };
  }
}

/** Run a WASM-backed skill comparison for a prebuilt plan entry. Worker-safe. */
/**
 * Identity key for a baseline vacuum: every candidate in a basin run shares the
 * same baseline runner, so its result can be reused instead of re-simulated per
 * skill. Within a run the only things that vary are the sample count (per stage)
 * and — rarely — the skill ordering, so the key captures seed + samples + the
 * baseline skill order. Reused results are read-only in the reduction.
 */
function baselineKey(params: WasmCompareParams): string {
  const skillOrder = (params.runners[0]?.skills ?? []).map((skill) => skill.skillId).join(',');
  return `${params.masterSeed}:${params.nsamples}:${skillOrder}`;
}

/** Per-run cache of baseline vacuum results, keyed by {@link baselineKey}. */
export type BaselineCache = Map<string, Promise<WasmCompareData>>;

async function runSkillComparisonFromEntry(
  entry: SkillSamplingPlanEntry,
  baselineCache?: BaselineCache
): Promise<SkillComparisonResult> {
  const {
    skillId: trackedSkillId,
    nsamples,
    fallback,
    wasmParamsBaseline,
    wasmParamsTracked
  } = entry;

  // The baseline (runner without the tracked skill) is identical across every
  // candidate in the run — run it once and reuse, instead of per skill.
  const key = baselineKey(wasmParamsBaseline);
  let baselinePromise = baselineCache?.get(key);
  if (!baselinePromise) {
    baselinePromise = runCompare(wasmParamsBaseline);
    baselineCache?.set(key, baselinePromise);
  }

  const [dataA, dataB] = await Promise.all([baselinePromise, runCompare(wasmParamsTracked)]);

  const diff: Array<number> = [];
  const trackedMetaCollection: Array<SkillTrackedMeta> = [];
  const sampleCutoff = Math.max(Math.floor(nsamples * 0.8), nsamples - 200);
  const representatives = new RepresentativeRunTracker(sampleCutoff);

  for (let i = 0; i < nsamples; ++i) {
    const { basinn, data, trackedMeta } = summarizeSample(
      dataA.rounds[i],
      dataB.rounds[i],
      trackedSkillId,
      fallback
    );
    if (trackedMeta) {
      trackedMetaCollection.push(trackedMeta);
    }
    diff.push(basinn);
    representatives.observe(i, basinn, data, diff);
  }

  diff.sort((a, b) => a - b);
  const mid = Math.floor(diff.length / 2);
  const median = diff.length % 2 === 0 ? (diff[mid - 1] + diff[mid]) / 2 : diff[mid];
  const mean = diff.reduce((a, b) => a + b) / diff.length;

  const skillActivations: Record<string, SkillTrackedMetaCollection> =
    trackedMetaCollection.length > 0 ? { [trackedSkillId]: trackedMetaCollection } : {};

  return {
    results: diff,
    skillActivations,
    runData: representatives.toRunData(),
    min: diff[0],
    max: diff[diff.length - 1],
    mean,
    median
  };
}

/**
 * WASM-backed equivalent of `runSampling`, driven by a prebuilt plan (one entry
 * per skill). Worker-safe: every data lookup was resolved on the main thread by
 * `buildSkillSamplingPlan`.
 */
export async function runSamplingFromPlan(
  plan: SkillSamplingPlan,
  baselineCache?: BaselineCache
): Promise<SkillComparisonResponse> {
  const data: SkillComparisonResponse = {};

  for (const entry of plan.entries) {
    const { results, runData, min, max, mean, median, skillActivations } =
      await runSkillComparisonFromEntry(entry, baselineCache);

    data[entry.skillId] = {
      id: entry.skillId,
      results,
      skillActivations,
      runData,
      min,
      max,
      mean,
      median,
      filterReason: undefined
    };
  }

  return data;
}
