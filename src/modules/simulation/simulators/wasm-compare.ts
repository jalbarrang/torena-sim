// WASM-backed compare orchestration. Sources per-round, per-runner telemetry
// from the Rust contested compare read-model. The bashin-delta + summary
// statistics live here on the TS side; the WASM boundary stays lean (one batch
// call per worker chunk + this reduction).

import type {
  CompareResult,
  FirstUMAStats,
  SimulationRun,
  StaminaStats,
  Stats
} from '@/modules/simulation/compare.types';
import type { CollectedRunnerRoundData } from '@/lib/uma-domain/race/race-observer';
import type {
  WasmCompareData,
  WasmCompareRoundData,
  WasmContestedCompareParams
} from '@/lib/uma-sim-wasm/types';
import { initializeSimulationRun } from '@/modules/simulation/compare.types';
import { wasmCompareRoundDataToCollected } from '@/lib/uma-sim-wasm/adapter-results';
import { runContestedCompare } from '@/lib/uma-sim-wasm/loader';
import { computePositionDiff } from './shared-pure';

type CompareStatsAccumulator = {
  lengths: Array<number>;
  count: number;
};

function calculateStats(stats: CompareStatsAccumulator, totalSamples: number) {
  if (stats.lengths.length === 0) {
    return { min: 0, max: 0, mean: 0, frequency: 0 };
  }

  const min = Math.min(...stats.lengths);
  const max = Math.max(...stats.lengths);
  const mean = stats.lengths.reduce((sum, value) => sum + value, 0) / stats.lengths.length;
  const frequency = totalSamples > 0 ? (stats.count / totalSamples) * 100 : 0;

  return { min, max, mean, frequency };
}

/**
 * Reduce two aligned per-round telemetry streams into a {@link CompareResult}.
 *
 * `roundsA[i]` / `roundsB[i]` are the compared runners' round data for the same
 * seed `seed + i`.
 */
function reduceCompareRounds(
  roundsA: Array<CollectedRunnerRoundData>,
  roundsB: Array<CollectedRunnerRoundData>,
  nsamples: number
): CompareResult {
  const sign = 1;
  const diff: Array<number> = [];

  let min = Infinity;
  let max = -Infinity;
  let estMean = 0;
  let estMedian = 0;
  let bestMeanDiff = Infinity;
  let bestMedianDiff = Infinity;

  let minrun: SimulationRun = initializeSimulationRun();
  let maxrun: SimulationRun = initializeSimulationRun();
  let meanrun: SimulationRun = initializeSimulationRun();
  let medianrun: SimulationRun = initializeSimulationRun();

  const sampleCutoff = Math.max(Math.floor(nsamples * 0.8), nsamples - 200);

  const rushedStats = {
    uma1: { lengths: [], count: 0 } as CompareStatsAccumulator,
    uma2: { lengths: [], count: 0 } as CompareStatsAccumulator
  };
  const fullyChargedStats = {
    uma1: { lengths: [], count: 0 } as CompareStatsAccumulator,
    uma2: { lengths: [], count: 0 } as CompareStatsAccumulator
  };
  const leadCompetitionStats = {
    uma1: { lengths: [], count: 0 } as CompareStatsAccumulator,
    uma2: { lengths: [], count: 0 } as CompareStatsAccumulator
  };
  const duelingStats = {
    uma1: { lengths: [], count: 0 } as CompareStatsAccumulator,
    uma2: { lengths: [], count: 0 } as CompareStatsAccumulator
  };
  const staminaCounters = {
    uma1: { total: 0, hpDiedCount: 0, fullSpurtCount: 0 },
    uma2: { total: 0, hpDiedCount: 0, fullSpurtCount: 0 }
  };
  const firstUmaCounters = {
    uma1: { total: 0, firstPlaceCount: 0 },
    uma2: { total: 0, firstPlaceCount: 0 }
  };

  for (let i = 0; i < nsamples; ++i) {
    const roundA = roundsA[i];
    const roundB = roundsB[i];

    if (!roundA || !roundB) {
      throw new Error('Missing collected runner data for compare simulation');
    }

    const data: SimulationRun = initializeSimulationRun({
      time: [roundA.time, roundB.time],
      position: [roundA.position, roundB.position],
      velocity: [roundA.velocity, roundB.velocity],
      hp: [roundA.hp, roundB.hp],
      currentLane: [roundA.currentLane, roundB.currentLane],
      pacerGap: [roundA.pacerGap, roundB.pacerGap],
      skillActivations: [roundA.skillActivations, roundB.skillActivations],
      targetedSkillActivations: [roundA.targetedSkillActivations, roundB.targetedSkillActivations],
      startDelay: [roundA.startDelay, roundB.startDelay],
      rushed: [roundA.rushed, roundB.rushed],
      duelingRegions: [roundA.duelingRegion, roundB.duelingRegion],
      spotStruggleRegions: [roundA.spotStruggleRegion, roundB.spotStruggleRegion],
      fullyChargedRegions: [roundA.fullyChargedRegion, roundB.fullyChargedRegion],
      fullyChargedAccel: [roundA.fullyChargedAccel, roundB.fullyChargedAccel]
    });

    if (roundA.rushed.length > 0) {
      const [start, end] = roundA.rushed[0];
      rushedStats.uma1.lengths.push(end - start);
      rushedStats.uma1.count++;
    }
    if (roundB.rushed.length > 0) {
      const [start, end] = roundB.rushed[0];
      rushedStats.uma2.lengths.push(end - start);
      rushedStats.uma2.count++;
    }

    if (roundA.fullyChargedRegion.length === 2 && roundA.fullyChargedAccel != null) {
      fullyChargedStats.uma1.lengths.push(roundA.fullyChargedAccel);
      fullyChargedStats.uma1.count++;
    }
    if (roundB.fullyChargedRegion.length === 2 && roundB.fullyChargedAccel != null) {
      fullyChargedStats.uma2.lengths.push(roundB.fullyChargedAccel);
      fullyChargedStats.uma2.count++;
    }

    if (roundA.spotStruggleRegion.length === 2) {
      const [start, end] = roundA.spotStruggleRegion;
      leadCompetitionStats.uma1.lengths.push(end - start);
      leadCompetitionStats.uma1.count++;
    }
    if (roundB.spotStruggleRegion.length === 2) {
      const [start, end] = roundB.spotStruggleRegion;
      leadCompetitionStats.uma2.lengths.push(end - start);
      leadCompetitionStats.uma2.count++;
    }

    if (roundA.duelingRegion.length === 2) {
      const [start, end] = roundA.duelingRegion;
      duelingStats.uma1.lengths.push(end - start);
      duelingStats.uma1.count++;
    }
    if (roundB.duelingRegion.length === 2) {
      const [start, end] = roundB.duelingRegion;
      duelingStats.uma2.lengths.push(end - start);
      duelingStats.uma2.count++;
    }

    staminaCounters.uma1.total++;
    staminaCounters.uma2.total++;
    if (roundA.outOfHp) staminaCounters.uma1.hpDiedCount++;
    if (roundB.outOfHp) staminaCounters.uma2.hpDiedCount++;
    if (roundA.hasAchievedFullSpurt) staminaCounters.uma1.fullSpurtCount++;
    if (roundB.hasAchievedFullSpurt) staminaCounters.uma2.fullSpurtCount++;

    firstUmaCounters.uma1.total++;
    firstUmaCounters.uma2.total++;
    if (roundA.firstPositionInLateRace) firstUmaCounters.uma1.firstPlaceCount++;
    if (roundB.firstPositionInLateRace) firstUmaCounters.uma2.firstPlaceCount++;

    const positionDiff = computePositionDiff(roundA.position, roundB.position);
    const basinn = (sign * positionDiff) / 2.5;
    diff.push(basinn);

    if (basinn < min) {
      min = basinn;
      minrun = data;
    }
    if (basinn > max) {
      max = basinn;
      maxrun = data;
    }

    if (i === sampleCutoff) {
      diff.sort((a, b) => a - b);
      estMean = diff.reduce((sum, value) => sum + value, 0) / diff.length;
      const mid = Math.floor(diff.length / 2);
      estMedian = mid > 0 && diff.length % 2 === 0 ? (diff[mid - 1] + diff[mid]) / 2 : diff[mid];
    }

    if (i >= sampleCutoff) {
      const meanDiff = Math.abs(basinn - estMean);
      const medianDiff = Math.abs(basinn - estMedian);
      if (meanDiff < bestMeanDiff) {
        bestMeanDiff = meanDiff;
        meanrun = data;
      }
      if (medianDiff < bestMedianDiff) {
        bestMedianDiff = medianDiff;
        medianrun = data;
      }
    }
  }

  diff.sort((a, b) => a - b);

  const rushedSummary: Stats = {
    uma1: calculateStats(rushedStats.uma1, nsamples),
    uma2: calculateStats(rushedStats.uma2, nsamples)
  };
  const fullyChargedSummary: Stats = {
    uma1: calculateStats(fullyChargedStats.uma1, nsamples),
    uma2: calculateStats(fullyChargedStats.uma2, nsamples)
  };
  const leadCompetitionSummary: Stats = {
    uma1: calculateStats(leadCompetitionStats.uma1, nsamples),
    uma2: calculateStats(leadCompetitionStats.uma2, nsamples)
  };
  const duelingSummary: Stats = {
    uma1: calculateStats(duelingStats.uma1, nsamples),
    uma2: calculateStats(duelingStats.uma2, nsamples)
  };
  const staminaSummary: StaminaStats = {
    uma1: {
      staminaSurvivalRate:
        staminaCounters.uma1.total > 0
          ? ((staminaCounters.uma1.total - staminaCounters.uma1.hpDiedCount) /
              staminaCounters.uma1.total) *
            100
          : 0,
      fullSpurtRate:
        staminaCounters.uma1.total > 0
          ? (staminaCounters.uma1.fullSpurtCount / staminaCounters.uma1.total) * 100
          : 0
    },
    uma2: {
      staminaSurvivalRate:
        staminaCounters.uma2.total > 0
          ? ((staminaCounters.uma2.total - staminaCounters.uma2.hpDiedCount) /
              staminaCounters.uma2.total) *
            100
          : 0,
      fullSpurtRate:
        staminaCounters.uma2.total > 0
          ? (staminaCounters.uma2.fullSpurtCount / staminaCounters.uma2.total) * 100
          : 0
    }
  };
  const firstUmaSummary: FirstUMAStats = {
    uma1: {
      firstPlaceRate:
        firstUmaCounters.uma1.total > 0
          ? (firstUmaCounters.uma1.firstPlaceCount / firstUmaCounters.uma1.total) * 100
          : 0
    },
    uma2: {
      firstPlaceRate:
        firstUmaCounters.uma2.total > 0
          ? (firstUmaCounters.uma2.firstPlaceCount / firstUmaCounters.uma2.total) * 100
          : 0
    }
  };

  return {
    results: diff,
    runData: { minrun, maxrun, meanrun, medianrun },
    rushedStats: rushedSummary,
    fullyChargedStats: fullyChargedSummary,
    leadCompetitionStats: leadCompetitionSummary,
    duelingStats: duelingSummary,
    spurtInfo: null,
    staminaStats: staminaSummary,
    firstUmaStats: firstUmaSummary
  };
}

function findComparedRunner(
  runners: Array<WasmCompareRoundData>,
  runnerId: number,
  roundIndex: number
): WasmCompareRoundData {
  const runner = runners.find((candidate) => candidate.runnerId === runnerId);
  if (!runner) {
    throw new Error(
      `Missing compared runner ${runnerId} in contested compare round ${roundIndex}; got runner ids [${runners
        .map((candidate) => candidate.runnerId)
        .join(', ')}]`
    );
  }
  return runner;
}

/**
 * Extract A/B runner telemetry from same-race compare rounds.
 *
 * The contested engine assigns runner ids by insertion order, so the two compared
 * runners are ids 0 and 1. The bashin delta is therefore a head-to-head same-race
 * gap (ADR-0007).
 */
export function splitContestedCompareRounds(data: WasmCompareData): CompareRounds {
  const comparedRunnerAId = 0;
  const comparedRunnerBId = 1;

  const roundsA: CompareRounds['roundsA'] = [];
  const roundsB: CompareRounds['roundsB'] = [];

  for (const [index, round] of data.rounds.entries()) {
    roundsA.push(
      wasmCompareRoundDataToCollected(findComparedRunner(round.runners, comparedRunnerAId, index))
    );
    roundsB.push(
      wasmCompareRoundDataToCollected(findComparedRunner(round.runners, comparedRunnerBId, index))
    );
  }

  return { roundsA, roundsB };
}

function assertAlignedRounds(rounds: CompareRounds, expectedSamples: number): void {
  if (rounds.roundsA.length !== expectedSamples || rounds.roundsB.length !== expectedSamples) {
    throw new Error(
      `Compare chunk returned ${rounds.roundsA.length}/${rounds.roundsB.length} A/B rounds; expected ${expectedSamples}`
    );
  }
}

/** Primary-runner round telemetry for both contestants, aligned by round index. */
export type CompareRounds = {
  roundsA: Array<CollectedRunnerRoundData>;
  roundsB: Array<CollectedRunnerRoundData>;
};

/**
 * A fully-resolved, data-free compare plan: the two runners already converted to
 * WASM boundary DTOs on the main thread (via `buildComparePlan` in
 * `wasm-compare-plan.ts`). The worker only varies seed/sample-count per chunk,
 * so it never touches the skill dataset. `baseSeed` is the master seed for
 * round 0; chunk `seedOffset` maps global round `seedOffset + j` to master seed
 * `baseSeed + seedOffset + j`, keeping chunked runs bit-for-bit identical.
 */
export type ContestedComparePlan = {
  mode: 'contested';
  wasmParamsContested: WasmContestedCompareParams;
  nsamples: number;
  baseSeed: number;
};

export type ComparePlan = ContestedComparePlan;

/**
 * Run a WASM contested batch for a prebuilt {@link ComparePlan} and return the
 * raw per-round A/B telemetry (no reduction). Worker-safe: it only overrides
 * `masterSeed` + `nsamples` on the already-resolved params.
 */
export async function runComparisonRoundsFromPlan(
  plan: ComparePlan,
  chunkSamples: number,
  seedOffset: number
): Promise<CompareRounds> {
  const masterSeed = plan.baseSeed + seedOffset;

  if (plan.wasmParamsContested.runners.length < 2) {
    throw new Error('Contested compare plan requires at least two compared runners');
  }

  const data = await runContestedCompare({
    ...plan.wasmParamsContested,
    masterSeed,
    nsamples: chunkSamples
  });
  const rounds = splitContestedCompareRounds(data);
  assertAlignedRounds(rounds, chunkSamples);
  return rounds;
}

/** Reduce aligned per-round telemetry into a {@link CompareResult}. */
export function reduceCompareRoundsPublic(rounds: CompareRounds, nsamples: number): CompareResult {
  return reduceCompareRounds(rounds.roundsA, rounds.roundsB, nsamples);
}
