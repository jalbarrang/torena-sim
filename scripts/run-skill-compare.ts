/**
 * CLI Debug Script for Skill Comparison
 * Usage: pnpm run skill:compare [options]
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command } from 'commander';

import { initCliData } from './lib/init-data';
import { DebugConfigSchema } from './runner-config.schema';
import type { IRunnerState } from '@/modules/runners/components/runner-card/types';
import { coursesService } from '@/modules/data/services/CourseService';
import { buildSkillSamplingPlan } from '@/modules/simulation/simulators/wasm-skill-compare-plan';
import { runSamplingFromPlan } from '@/modules/simulation/simulators/wasm-skill-compare';
import { racedefToParams } from '@/utils/races';

export const defaultSimulationOptions = {
  allowRushedUma1: false,
  allowRushedUma2: false,
  allowDownhillUma1: false,
  allowDownhillUma2: false,
  allowSectionModifierUma1: false,
  allowSectionModifierUma2: false,
  useEnhancedSpurt: false,
  accuracyMode: false,
  skillCheckChanceUma1: false,
  skillCheckChanceUma2: false
};

const program = new Command();

program
  .name('debug-skill-compare')
  .description('Debug skill comparison simulation')
  .argument('<skillId>', 'Skill ID to test')
  .option('-n, --samples <samples>', 'Number of samples to run', '100')
  .option('-s, --seed <seed>', 'Random seed', '0')
  .option('-c, --config <path>', 'Path to runner config JSON file')
  .option('-v, --verbose', 'Show detailed activation info', false)
  .action(async (skillId, options) => {
    initCliData();

    // Load and validate config

    const samples = Number.parseInt(options.samples);
    let seed = Number.parseInt(options.seed);
    if (seed === 0) {
      seed = Math.floor(Math.random() * 1000000);
    }

    let config;
    try {
      const configPath = resolve(options.config);
      const configContent = readFileSync(configPath, 'utf-8');
      const rawConfig = JSON.parse(configContent);
      config = DebugConfigSchema.parse(rawConfig);
      console.log(`✅ Loaded config from: ${options.config}\n`);
    } catch (error) {
      if (error instanceof Error) {
        console.error('❌ Failed to load config:', error.message);
        if ('issues' in error) {
          console.error('\nValidation errors:');
          for (const issue of (error as any).issues) {
            console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
          }
        }
      }
      process.exit(1);
    }

    const { runner, raceConditions, courseId } = config;

    console.log(`🏇 Debugging Skill Comparison for skill: ${skillId}`);
    console.log(`   Samples: ${samples}, Course: ${courseId}, Seed: ${seed}`);
    console.log(`   Runner: ${runner.outfitId} (${runner.strategy})`);
    console.log(`   Base skills: ${runner.skills.join(', ') || 'none'}\n`);

    const course = coursesService.getSimCourse(courseId);
    const raceParams = racedefToParams(raceConditions, runner.strategy);

    const simOptions = {
      ...defaultSimulationOptions,
      seed
    };

    const testRunner: IRunnerState = runner;

    console.log('Running comparison...\n');

    const plan = buildSkillSamplingPlan({
      nsamples: samples,
      skills: [skillId],
      course,
      racedef: raceParams,
      uma: testRunner,
      options: simOptions
    });
    const response = await runSamplingFromPlan(plan);
    const result = response[skillId];
    if (!result) {
      throw new Error(`WASM skill comparison produced no result for ${skillId}`);
    }

    console.log('📊 Results:');
    console.log(`  Results array length: ${result.results.length}`);
    console.log(`  Min: ${result.min.toFixed(3)}`);
    console.log(`  Max: ${result.max.toFixed(3)}`);
    console.log(`  Mean: ${result.mean.toFixed(3)}`);
    console.log(`  Median: ${result.median.toFixed(3)}`);
    console.log(`  Raw results: ${result.results.map((r) => r.toFixed(3)).join(', ')}`);

    console.log('\n🎯 Skill Activation Summary:');
    console.log(
      `\nℹ️  Note: Activation data is captured for specific representative runs (min/max/mean/median),`
    );
    console.log(
      `   not all ${samples} samples. Use DEBUG_SKILL_ACTIVATIONS=1 to see all activations in real-time.\n`
    );

    console.log('Runner A (base skills) - from minrun:');
    console.log(`  Unique skills activated: ${Object.keys(result.runData.minrun.sk[0]).length}`);
    if (options.verbose) {
      console.log(`  sk[0] data:`, JSON.stringify(result.runData.minrun.sk[0], null, 2));
    }

    console.log('\nRunner B (base skills + test skill) - from minrun:');
    console.log(`  Unique skills activated: ${Object.keys(result.runData.minrun.sk[1]).length}`);
    if (options.verbose) {
      console.log(`  sk[1] data:`, JSON.stringify(result.runData.minrun.sk[1], null, 2));
    }

    console.log('\n📈 All Run Types:');
    for (const runType of ['minrun', 'maxrun', 'meanrun', 'medianrun']) {
      const run = result.runData[runType as keyof typeof result.runData];
      const totalActivations =
        Object.values(run.sk[0]).flat().length + Object.values(run.sk[1]).flat().length;

      console.log(`  ${runType}: ${totalActivations} total activations`);

      // Show detailed breakdown for this run if verbose
      if (options.verbose && totalActivations > 0) {
        for (const umaIndex of [0, 1]) {
          const skillMap = run.sk[umaIndex];
          for (const [executionId, activations] of Object.entries(skillMap)) {
            console.log(
              `    Uma ${umaIndex}, execution ${executionId}: ${activations.length} activations`
            );
            for (const [i, act] of activations.entries()) {
              console.log(
                `      [${i}] ${act.skillId} @ ${Math.round(act.start)}m-${Math.round(act.end)}m (${act.effectType})`
              );
            }
          }
        }
      }
    }

    console.log('\n✅ Debug complete!\n');
  });

program.parse();
