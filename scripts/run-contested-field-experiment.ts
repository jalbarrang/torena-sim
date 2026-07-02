/**
 * Contested-compare field-composition experiment (contested-compare-ui t-003).
 *
 * Compares `duo` (two umas only) vs `mobs` (two umas + 7 generated mobs) as the
 * default field composition for same-race compare, across a few representative
 * matchups. Reports, per mode:
 *   (a) delta stability  — stddev of the per-round finish-time delta (variance);
 *   (b) mechanic emergence — fraction of rounds where spot-struggle / dueling
 *       regions appear for the two compared runners;
 *   (c) qualitative note on order-dependent skill realism (field size).
 *
 * Usage:
 *   bun run wasm:build            # once, so the CLI wasm has runContestedCompare
 *   bun scripts/run-contested-field-experiment.ts
 *   bun scripts/run-contested-field-experiment.ts --samples 500 --seed 7
 */

import { Command } from 'commander';

import { initCliData } from './lib/init-data';
import { ensureCliWasm } from './lib/wasm-init';
import type { CreateRunner, RunnerAptitudes, StatLine } from '@/lib/uma-domain/runner/types';
import type { RaceParameters, SimulationSettings } from '@/lib/uma-domain/race/types';
import type { WasmCompareRoundData } from '@/lib/uma-sim-wasm/types';
import { coursesService } from '@/modules/data/services/CourseService';
import { parseAptitudeName, parseStrategyName } from '@/lib/uma-domain/runner/runner.types';
import { contestedCompareParamsToWasm } from '@/lib/uma-sim-wasm/adapter-params';

const RUNAWAY_SKILL_ID = '202051';

const SETTINGS: SimulationSettings = {
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

const RACE_CONDITIONS: RaceParameters = {
  ground: 1 as never,
  weather: 1 as never,
  season: 1 as never,
  timeOfDay: 1 as never,
  grade: 100 as never
};

type StatInput = {
  speed: number;
  stamina: number;
  power: number;
  guts: number;
  wisdom: number;
};

function makeRunner(
  strategy: string,
  stats: StatInput,
  extraSkills: Array<string> = []
): CreateRunner {
  const aptitudes: RunnerAptitudes = {
    distance: parseAptitudeName('A'),
    surface: parseAptitudeName('A'),
    strategy: parseAptitudeName('A')
  };
  const statLine: StatLine = {
    speed: stats.speed,
    stamina: stats.stamina,
    power: stats.power,
    guts: stats.guts,
    wit: stats.wisdom
  };
  const skills = strategy === 'Runaway' ? [RUNAWAY_SKILL_ID, ...extraSkills] : extraSkills;
  return {
    outfitId: '100101',
    mood: 2 as never,
    strategy: parseStrategyName(strategy),
    aptitudes,
    stats: statLine,
    skills
  };
}

type Matchup = {
  key: string;
  label: string;
  courseId: number;
  runnerA: CreateRunner;
  runnerB: CreateRunner;
};

const BALANCED: StatInput = { speed: 1200, stamina: 1000, power: 1000, guts: 700, wisdom: 900 };
const SLIGHTLY_SLOWER: StatInput = { ...BALANCED, speed: 1150 };

const MATCHUPS: Array<Matchup> = [
  {
    key: 'runaway-vs-frontrunner-mid',
    label: 'Runaway vs Front Runner (2000m turf)',
    courseId: 10104,
    runnerA: makeRunner('Runaway', BALANCED),
    runnerB: makeRunner('Front Runner', BALANCED)
  },
  {
    key: 'pacechaser-mirror-mile',
    label: 'Pace Chaser vs Pace Chaser (1600m turf)',
    courseId: 10304,
    runnerA: makeRunner('Pace Chaser', BALANCED),
    runnerB: makeRunner('Pace Chaser', SLIGHTLY_SLOWER)
  },
  {
    key: 'frontrunner-mirror-mid',
    label: 'Front Runner mirror (2000m turf)',
    courseId: 10104,
    runnerA: makeRunner('Front Runner', BALANCED),
    runnerB: makeRunner('Front Runner', SLIGHTLY_SLOWER)
  }
];

function stdev(values: Array<number>): number {
  if (values.length < 2) return 0;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function mean(values: Array<number>): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function finishTime(runner: WasmCompareRoundData): number {
  return runner.time.at(-1) ?? 0;
}

type ModeStats = {
  timeDeltaStdev: number;
  timeDeltaMeanAbs: number;
  spotStruggleRateA: number;
  spotStruggleRateB: number;
  duelingRateA: number;
  duelingRateB: number;
  outOfHpRate: number;
};

async function runMode(
  matchup: Matchup,
  fillMobs: boolean,
  samples: number,
  seed: number
): Promise<ModeStats> {
  const wasm = await ensureCliWasm();
  const course = coursesService.getSimCourse(matchup.courseId);

  const data = wasm.runContestedCompare(
    contestedCompareParamsToWasm({
      course,
      parameters: RACE_CONDITIONS,
      settings: SETTINGS,
      runners: [matchup.runnerA, matchup.runnerB],
      names: ['A', 'B'],
      fillMobs,
      nsamples: samples,
      masterSeed: seed
    })
  );

  const timeDeltas: Array<number> = [];
  let ssA = 0;
  let ssB = 0;
  let duelA = 0;
  let duelB = 0;
  let outOfHp = 0;

  for (const round of data.rounds) {
    const [a, b] = round.runners;
    if (!a || !b) continue;
    timeDeltas.push(finishTime(b) - finishTime(a));
    if (a.spotStruggleRegion) ssA++;
    if (b.spotStruggleRegion) ssB++;
    if (a.duelingRegion) duelA++;
    if (b.duelingRegion) duelB++;
    if (a.outOfHp || b.outOfHp) outOfHp++;
  }

  const n = data.rounds.length || 1;
  return {
    timeDeltaStdev: stdev(timeDeltas),
    timeDeltaMeanAbs: mean(timeDeltas.map(Math.abs)),
    spotStruggleRateA: ssA / n,
    spotStruggleRateB: ssB / n,
    duelingRateA: duelA / n,
    duelingRateB: duelB / n,
    outOfHpRate: outOfHp / n
  };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const sec = (x: number) => `${x.toFixed(4)}s`;

const program = new Command();
program
  .name('contested-field-experiment')
  .option('-n, --samples <number>', 'Samples per matchup/mode', '400')
  .option('-s, --seed <number>', 'Master seed', '1')
  .action(async (options) => {
    const samples = Number.parseInt(options.samples, 10);
    const seed = Number.parseInt(options.seed, 10);
    if (!Number.isFinite(samples) || samples <= 0) {
      throw new Error(`Invalid --samples: ${options.samples}`);
    }

    initCliData();

    console.log(`Contested field-composition experiment`);
    console.log(`  samples/mode: ${samples}, seed: ${seed}\n`);

    for (const matchup of MATCHUPS) {
      console.log(`## ${matchup.label} [${matchup.key}]`);
      const duo = await runMode(matchup, false, samples, seed);
      const mobs = await runMode(matchup, true, samples, seed);

      const row = (name: string, d: number, m: number, fmt: (x: number) => string) =>
        console.log(`  ${name.padEnd(24)} duo=${fmt(d).padEnd(10)} mobs=${fmt(m)}`);

      row('time-delta stdev', duo.timeDeltaStdev, mobs.timeDeltaStdev, sec);
      row('time-delta mean|abs|', duo.timeDeltaMeanAbs, mobs.timeDeltaMeanAbs, sec);
      row('spot-struggle A', duo.spotStruggleRateA, mobs.spotStruggleRateA, pct);
      row('spot-struggle B', duo.spotStruggleRateB, mobs.spotStruggleRateB, pct);
      row('dueling A', duo.duelingRateA, mobs.duelingRateA, pct);
      row('dueling B', duo.duelingRateB, mobs.duelingRateB, pct);
      row('out-of-HP (either)', duo.outOfHpRate, mobs.outOfHpRate, pct);
      console.log('');
    }
  });

program.parse();
