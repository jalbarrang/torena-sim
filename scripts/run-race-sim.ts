/**
 * Race sim CLI for testing the full 9-runner simulation.
 *
 *
 * Usage:
 *   pnpm exec tsx scripts/run-race-sim.ts
 *   pnpm exec tsx scripts/run-race-sim.ts --samples 5 --seed 42
 *   pnpm exec tsx scripts/run-race-sim.ts --course 10009 --samples 3
 */

import { Command } from 'commander';

import { initCliData } from './lib/init-data';
import { ensureCliWasm } from './lib/wasm-init';
import { coursesService } from '@/modules/data/services/CourseService';
import { generateMobField } from '@/lib/uma-domain/race/mob-factory';
import { raceSimParamsToWasm } from '@/lib/uma-sim-wasm/adapter-params';
import { wasmResultToRaceSimResult } from '@/lib/uma-sim-wasm/adapter-results';
import type { RaceSimResult } from '@/lib/uma-domain/race/run-race-sim';
import { StrategyName } from '@/lib/uma-domain/runner/definitions';
import type { RaceParameters } from '@/lib/uma-domain/race/types';
import {
  GroundCondition,
  Season,
  TimeOfDay,
  Weather,
  Grade
} from '@/lib/uma-domain/course/definitions';

const DEFAULT_COURSE_ID = 10101;

function createDefaultRaceParams(): RaceParameters {
  return {
    ground: GroundCondition.Good,
    weather: Weather.Sunny,
    season: Season.Spring,
    timeOfDay: TimeOfDay.Midday,
    grade: Grade.G1
  };
}

function printResults(result: RaceSimResult, courseDistance: number): void {
  const { finishOrders } = result;

  for (let i = 0; i < finishOrders.length; i++) {
    console.log(`\n--- Sample ${i + 1} ---`);
    console.log(
      `${'Pos'.padStart(4)} | ${'Runner'.padEnd(12)} | ${'Strategy'.padEnd(14)} | ${'Overshoot'.padStart(10)}`
    );
    console.log('-'.repeat(52));

    for (let j = 0; j < finishOrders[i].length; j++) {
      const entry = finishOrders[i][j];
      const overshoot = (entry.finishPosition - courseDistance).toFixed(2);
      const strategyName = StrategyName[entry.strategy] ?? `Strat(${entry.strategy})`;

      console.log(
        `${String(j + 1).padStart(4)} | ${entry.name.padEnd(12)} | ${strategyName.padEnd(14)} | ${overshoot.padStart(10)}`
      );
    }
  }

  if (finishOrders.length > 1) {
    console.log('\n--- Averages ---');

    const avgPositions = new Map<number, { name: string; total: number; count: number }>();

    for (const finishOrder of finishOrders) {
      for (let j = 0; j < finishOrder.length; j++) {
        const entry = finishOrder[j];
        const existing = avgPositions.get(entry.runnerId) ?? {
          name: entry.name,
          total: 0,
          count: 0
        };
        existing.total += j + 1;
        existing.count += 1;
        avgPositions.set(entry.runnerId, existing);
      }
    }

    const sorted = Array.from(avgPositions.entries())
      .map(([runnerId, { name, total, count }]) => ({ runnerId, name, avg: total / count }))
      .sort((a, b) => a.avg - b.avg);

    console.log(`${'Avg'.padStart(6)} | ${'Runner'.padEnd(12)}`);
    console.log('-'.repeat(22));
    for (const row of sorted) {
      console.log(`${row.avg.toFixed(2).padStart(6)} | ${row.name.padEnd(12)}`);
    }
  }
}

async function main() {
  const program = new Command()
    .option('--course <id>', 'Course ID', String(DEFAULT_COURSE_ID))
    .option('--samples <n>', 'Number of samples', '1')
    .option('--seed <n>', 'Master seed (random if omitted)')
    .parse(process.argv);

  const opts = program.opts();
  const courseId = Number(opts.course);
  const nsamples = Number(opts.samples);
  const masterSeed =
    opts.seed !== undefined ? Number(opts.seed) : Math.floor(Math.random() * 1_000_000);

  initCliData();

  console.log(`Course: ${courseId}`);
  console.log(`Samples: ${nsamples}`);
  console.log(`Seed: ${masterSeed}`);

  const course = coursesService.getSimCourse(courseId);
  console.log(`Distance: ${course.distance}m`);

  const runners = generateMobField();
  console.log(`Runners: ${runners.length}`);

  const start = performance.now();

  const wasm = await ensureCliWasm();
  const wasmParams = raceSimParamsToWasm(
    {
      course,
      parameters: createDefaultRaceParams(),
      runners,
      nsamples,
      masterSeed
    },
    (_runner, index) => `Mob ${index + 1}`
  );
  const result = wasmResultToRaceSimResult(wasm.runRaceSim(wasmParams));

  const elapsed = performance.now() - start;
  console.log(`Elapsed: ${elapsed.toFixed(1)}ms`);

  printResults(result, course.distance);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
