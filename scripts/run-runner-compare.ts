/**
 * Runner compare CLI for Sunday engine.
 *
 * Usage:
 *   pnpm exec tsx scripts/run-runner-compare.ts
 *   pnpm exec tsx scripts/run-runner-compare.ts --samples 200 --seed 42
 *   pnpm exec tsx scripts/run-runner-compare.ts --json
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Command } from 'commander';

import { initCliData } from './lib/init-data';
import { ensureCliWasm } from './lib/wasm-init';
import type { CreateRunner, RunnerAptitudes, StatLine } from '@/lib/uma-domain/runner/types';
import type { DuelingRates, RaceParameters, SimulationSettings } from '@/lib/uma-domain/race/types';
import { coursesService } from '@/modules/data/services/CourseService';
import { parseAptitudeName, parseStrategyName } from '@/lib/uma-domain/runner/runner.types';
import { compareParamsToWasm } from '@/lib/uma-sim-wasm/adapter-params';
import { wasmCompareRoundDataToCollected } from '@/lib/uma-sim-wasm/adapter-results';

type RunnerConfigInput = {
  outfitId: string;
  speed: number;
  stamina: number;
  power: number;
  guts: number;
  wisdom: number;
  strategy: string;
  distanceAptitude: string;
  surfaceAptitude: string;
  strategyAptitude: string;
  mood: number;
  skills: Array<string>;
};

type ConfigInput = {
  runner: RunnerConfigInput;
  courseId: number;
  raceConditions: {
    mood: number;
    ground: number;
    weather: number;
    season: number;
    time: number;
    grade: number;
  };
};

type SampleResult = {
  seed: number;
  timeA: number;
  timeB: number;
  /**
   * Signed time delta in seconds: (runnerB - runnerA).
   * Positive => runnerA finished faster.
   */
  timeDelta: number;
  timeDiffAbs: number;
  finalPosA: number;
  finalPosB: number;
  /**
   * Signed position delta in meters: (runnerA - runnerB).
   * Positive => runnerA ended farther ahead.
   */
  posDelta: number;
  posDiffAbs: number;
};

const CONFIG_RUNNER_1 = 'scripts/runners/runner-1.json';
const CONFIG_RUNNER_2 = 'scripts/runners/runner-2.json';

const DEFAULT_SETTINGS: SimulationSettings = {
  mode: 'compare',
  healthSystem: true,
  sectionModifier: true,
  rushed: true,
  downhill: true,
  spotStruggle: true,
  dueling: true,
  witChecks: true,
  positionKeepMode: 0
};

const DEFAULT_DUELING_RATES: DuelingRates = {
  runaway: 10,
  frontRunner: 10,
  paceChaser: 10,
  lateSurger: 10,
  endCloser: 10
};

function toCreateRunner(input: RunnerConfigInput): CreateRunner {
  const aptitudes: RunnerAptitudes = {
    distance: parseAptitudeName(input.distanceAptitude),
    surface: parseAptitudeName(input.surfaceAptitude),
    strategy: parseAptitudeName(input.strategyAptitude)
  };

  const stats: StatLine = {
    speed: input.speed,
    stamina: input.stamina,
    power: input.power,
    guts: input.guts,
    wit: input.wisdom
  };

  return {
    outfitId: input.outfitId,
    mood: input.mood as any,
    strategy: parseStrategyName(input.strategy),
    aptitudes,
    stats,
    skills: input.skills
  };
}

function toRaceParameters(input: ConfigInput['raceConditions']): RaceParameters {
  return {
    ground: input.ground as any,
    weather: input.weather as any,
    season: input.season as any,
    timeOfDay: input.time as any,
    grade: input.grade as any
  };
}

async function loadConfig(path: string): Promise<ConfigInput> {
  const resolved = resolve(path);
  try {
    const content = await readFile(resolved, 'utf8');
    return JSON.parse(content) as ConfigInput;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Config file not found: ${path}`, { cause: error });
    }

    throw error;
  }
}

async function runRunnerCompare(options: {
  samples: number;
  seed: number;
}): Promise<{ results: Array<SampleResult> }> {
  initCliData();

  const configRunner1 = await loadConfig(CONFIG_RUNNER_1);
  const configRunner2 = await loadConfig(CONFIG_RUNNER_2);

  if (
    !configRunner1?.runner ||
    !configRunner1?.raceConditions ||
    typeof configRunner1.courseId !== 'number'
  ) {
    throw new Error(`Invalid config format in ${CONFIG_RUNNER_1}`);
  }
  if (
    !configRunner2?.runner ||
    !configRunner2?.raceConditions ||
    typeof configRunner2.courseId !== 'number'
  ) {
    throw new Error(`Invalid config format in ${CONFIG_RUNNER_2}`);
  }

  if (configRunner1.courseId !== configRunner2.courseId) {
    throw new Error(
      `Course mismatch: ${CONFIG_RUNNER_1}=${configRunner1.courseId}, ${CONFIG_RUNNER_2}=${configRunner2.courseId}`
    );
  }

  const raceConditions1 = JSON.stringify(configRunner1.raceConditions);
  const raceConditions2 = JSON.stringify(configRunner2.raceConditions);
  if (raceConditions1 !== raceConditions2) {
    throw new Error(`Race conditions mismatch between ${CONFIG_RUNNER_1} and ${CONFIG_RUNNER_2}`);
  }

  const course = coursesService.getSimCourse(configRunner1.courseId);
  const runnerAConfig = toCreateRunner(configRunner1.runner);
  const runnerBConfig = toCreateRunner(configRunner2.runner);
  const raceParameters = toRaceParameters(configRunner1.raceConditions);

  const wasm = await ensureCliWasm();
  const [dataA, dataB] = await Promise.all([
    wasm.runCompare(
      compareParamsToWasm({
        course,
        parameters: raceParameters,
        settings: DEFAULT_SETTINGS,
        duelingRates: DEFAULT_DUELING_RATES,
        runner: runnerAConfig,
        name: 'Runner A',
        nsamples: options.samples,
        masterSeed: options.seed
      })
    ),
    wasm.runCompare(
      compareParamsToWasm({
        course,
        parameters: raceParameters,
        settings: DEFAULT_SETTINGS,
        duelingRates: DEFAULT_DUELING_RATES,
        runner: runnerBConfig,
        name: 'Runner B',
        nsamples: options.samples,
        masterSeed: options.seed
      })
    )
  ]);

  const results: Array<SampleResult> = [];

  for (let i = 0; i < options.samples; i++) {
    const roundA = dataA.rounds[i]?.runners[0];
    const roundB = dataB.rounds[i]?.runners[0];
    if (!roundA || !roundB) {
      throw new Error(`Missing WASM compare data for sample ${i}`);
    }

    const runnerA = wasmCompareRoundDataToCollected(roundA);
    const runnerB = wasmCompareRoundDataToCollected(roundB);
    const timeA = runnerA.time.at(-1) ?? 0;
    const timeB = runnerB.time.at(-1) ?? 0;
    const finalPosA = runnerA.position.at(-1) ?? 0;
    const finalPosB = runnerB.position.at(-1) ?? 0;
    const timeDelta = timeB - timeA;
    const timeDiffAbs = Math.abs(timeDelta);
    const posDelta = finalPosA - finalPosB;
    const posDiffAbs = Math.abs(posDelta);

    results.push({
      seed: options.seed + i,
      timeA,
      timeB,
      timeDelta,
      timeDiffAbs,
      finalPosA,
      finalPosB,
      posDelta,
      posDiffAbs
    });
  }

  return { results };
}

function mean(values: Array<number>): number {
  if (values.length === 0) return 0;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

function percentile(values: Array<number>, p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) {
    return sorted[lower];
  }

  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

const program = new Command();

program
  .name('runner-compare')
  .description('Compare Sunday runner-1 against runner-2')
  .option('-n, --samples <number>', 'Number of samples', '100')
  .option('-s, --seed <number>', 'Starting seed', '1')
  .option('-e, --epsilon <number>', 'Allowed float tolerance', '1e-9')
  .option('--json', 'Print full per-sample JSON output', false)
  .action(async (options) => {
    const samples = Number.parseInt(options.samples, 10);
    const seed = Number.parseInt(options.seed, 10);
    const epsilon = Number.parseFloat(options.epsilon);

    if (!Number.isFinite(samples) || samples <= 0) {
      throw new Error(`Invalid --samples value: "${options.samples}"`);
    }
    if (!Number.isFinite(seed)) {
      throw new TypeError(`Invalid --seed value: "${options.seed}"`);
    }
    if (!Number.isFinite(epsilon) || epsilon < 0) {
      throw new Error(`Invalid --epsilon value: "${options.epsilon}"`);
    }

    const { results } = await runRunnerCompare({
      samples,
      seed
    });

    const timeDeltas = results.map((r) => r.timeDelta);
    const posDeltas = results.map((r) => r.posDelta);
    const timeDiffsAbs = results.map((r) => r.timeDiffAbs);
    const posDiffsAbs = results.map((r) => r.posDiffAbs);

    const winsA = results.filter((r) => r.timeDelta > epsilon).length;
    const winsB = results.filter((r) => r.timeDelta < -epsilon).length;
    const ties = results.length - winsA - winsB;

    const toPct = (n: number) => ((n / samples) * 100).toFixed(2);

    console.log('Runner compare');
    console.log(`  runnerA config: ${CONFIG_RUNNER_1}`);
    console.log(`  runnerB config: ${CONFIG_RUNNER_2}`);
    console.log(`  samples: ${samples}`);
    console.log(`  seed range: ${seed}..${seed + samples - 1}`);
    console.log(`  tie epsilon (seconds): ${epsilon}`);
    console.log(`  runnerA wins: ${winsA}/${samples} (${toPct(winsA)}%)`);
    console.log(`  runnerB wins: ${winsB}/${samples} (${toPct(winsB)}%)`);
    console.log(`  ties: ${ties}/${samples} (${toPct(ties)}%)`);

    console.log('\nTime delta: runnerB - runnerA (sec, + means runnerA faster)');
    console.log(`  mean: ${mean(timeDeltas)}`);
    console.log(`  median: ${percentile(timeDeltas, 0.5)}`);
    console.log(`  p10/p90: ${percentile(timeDeltas, 0.1)} / ${percentile(timeDeltas, 0.9)}`);
    console.log(`  min/max: ${Math.min(...timeDeltas)} / ${Math.max(...timeDeltas)}`);
    console.log(`  mean abs: ${mean(timeDiffsAbs)}`);

    console.log('\nPosition delta: runnerA - runnerB (m, + means runnerA ahead)');
    console.log(`  mean: ${mean(posDeltas)}`);
    console.log(`  median: ${percentile(posDeltas, 0.5)}`);
    console.log(`  p10/p90: ${percentile(posDeltas, 0.1)} / ${percentile(posDeltas, 0.9)}`);
    console.log(`  min/max: ${Math.min(...posDeltas)} / ${Math.max(...posDeltas)}`);
    console.log(`  mean abs: ${mean(posDiffsAbs)}`);

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      const strongestSamples = [...results]
        .sort((a, b) => b.timeDiffAbs - a.timeDiffAbs)
        .slice(0, 5);

      if (strongestSamples.length > 0) {
        console.log('\nLargest |time delta| samples:');
        for (const sample of strongestSamples) {
          console.log(
            `  seed=${sample.seed} timeDelta=${sample.timeDelta} posDelta=${sample.posDelta}`
          );
        }
      }
    }
  });

program.parse();
