// Main-thread builder for the WASM planner context. This is the data-dependent
// half of the planner path: it resolves every constant across candidate
// combinations (course/params/settings/runner stats + display name) into WASM
// DTOs once, plus the `skillInputs` / `groupIds` lookups covering all obtained
// and candidate skills. The optimizer worker then assembles each combination's
// runner from this context without touching the dataset.

import type { IRunnerState } from '@/modules/runners/components/runner-card/domain/runner-state';
import type { CourseData } from '@/lib/uma-domain/course/definitions';
import type { RaceParameters } from '@/lib/uma-domain/race/types';
import type { SimulationOptions } from '@/modules/simulation/types';
import {
  compareSettingsToWasm,
  courseDataToWasm,
  duelingRatesToWasm,
  raceParametersToWasm,
  resolveSkillInput,
  sundayRunnerToWasm
} from '@/lib/uma-sim-wasm/adapter-params';
import { skillsService } from '@/modules/data/services/SkillService';
import { getUmaDisplayInfo } from '@/modules/runners/utils';
import { createPlannerCompareSettings } from './skill-planner-compare';
import { DEFAULT_DUELING_RATES, normalizeSkillId, toCreateRunner } from './shared-pure';
import { toSundayRaceParameters } from './shared-pure';
import type { PlannerWasmContext } from './wasm-skill-planner';

export type BuildPlannerContextArgs = {
  runner: IRunnerState;
  /** Every skill the optimizer may reference (obtained + all candidates). */
  skillIds: Array<string>;
  course: CourseData;
  racedef: RaceParameters;
  ignoreStaminaConsumption: boolean;
  options: SimulationOptions;
};

function resolveRunnerName(outfitId: string): string {
  const info = outfitId ? getUmaDisplayInfo(outfitId) : null;
  return info?.name ?? 'Runner';
}

/** Resolve the planner run's constants into a data-free {@link PlannerWasmContext}. */
export function buildPlannerWasmContext(args: BuildPlannerContextArgs): PlannerWasmContext {
  const { runner, skillIds, course, racedef, ignoreStaminaConsumption, options } = args;

  const settings = createPlannerCompareSettings(
    ignoreStaminaConsumption,
    options.staminaDrainOverrides
  );

  // Runner DTO with no skills; the worker injects each combination's resolved
  // skill inputs per evaluation.
  const runnerBase = sundayRunnerToWasm(
    toCreateRunner(runner, []),
    resolveRunnerName(runner.outfitId)
  );

  const skillInputs: Record<string, ReturnType<typeof resolveSkillInput>> = {};
  const groupIds: Record<string, number> = {};

  for (const skillId of skillIds) {
    if (!(skillId in skillInputs)) {
      skillInputs[skillId] = resolveSkillInput(skillId);
    }
    const baseId = normalizeSkillId(skillId);
    if (!(baseId in groupIds)) {
      const groupId = skillsService.getById(baseId)?.groupId;
      if (groupId != null) {
        groupIds[baseId] = groupId;
      }
    }
  }

  // Drop unresolved skills so the map only carries real inputs.
  const resolvedInputs: PlannerWasmContext['skillInputs'] = {};
  for (const [id, input] of Object.entries(skillInputs)) {
    if (input) {
      resolvedInputs[id] = input;
    }
  }

  return {
    course: courseDataToWasm(course),
    parameters: raceParametersToWasm(toSundayRaceParameters(racedef)),
    settings: compareSettingsToWasm(settings),
    duelingRates: duelingRatesToWasm(DEFAULT_DUELING_RATES),
    runnerBase,
    skillInputs: resolvedInputs,
    groupIds,
    masterSeed: options.seed ?? 0
  };
}
