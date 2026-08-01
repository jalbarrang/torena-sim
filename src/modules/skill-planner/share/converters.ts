import type { IRunnerState } from '@/modules/runners/components/runner-card/domain/runner-state';
import { aptitudeToEncoding, encodingToAptitude } from '@/modules/runners/share/converters';
import { StrategyName } from '@/lib/uma-domain/runner/definitions';
import type { IStrategy, IStrategyName } from '@/lib/uma-domain/runner/definitions';
import type { SkillPlannerExportData } from './types';
import type { HintLevel } from '../types';

const strategyNameToValue: Record<IStrategyName, number> = Object.fromEntries(
  Object.entries(StrategyName).map(([k, v]) => [v, Number(k)])
) as Record<IStrategyName, number>;

const strategyValueToName: Record<number, IStrategyName> = Object.fromEntries(
  Object.entries(StrategyName).map(([k, v]) => [Number(k), v])
) as Record<number, IStrategyName>;

type BuildExportDataParams = {
  runner: IRunnerState;
  obtainedSkillIds: Array<string>;
  candidates: Array<{ skillId: string; hintLevel: HintLevel }>;
  budget: number;
  hasFastLearner: boolean;
};

export function buildExportData(params: BuildExportDataParams): SkillPlannerExportData {
  const { runner, obtainedSkillIds, candidates, budget, hasFastLearner } = params;

  const aptDistance = aptitudeToEncoding(runner.distanceAptitude);
  const aptSurface = aptitudeToEncoding(runner.surfaceAptitude);
  const aptStrategy = aptitudeToEncoding(runner.strategyAptitude);
  const strategy = strategyNameToValue[runner.strategy] ?? 1;

  return {
    card_id: Number.parseInt(runner.outfitId, 10) || 0,
    speed: runner.speed,
    stamina: runner.stamina,
    power: runner.power,
    guts: runner.guts,
    wiz: runner.wisdom,
    proper_distance_short: aptDistance,
    proper_distance_mile: aptDistance,
    proper_distance_middle: aptDistance,
    proper_distance_long: aptDistance,
    proper_ground_turf: aptSurface,
    proper_ground_dirt: aptSurface,
    proper_running_style_nige: aptStrategy,
    proper_running_style_senko: aptStrategy,
    proper_running_style_sashi: aptStrategy,
    proper_running_style_oikomi: aptStrategy,
    strategy,
    mood: runner.mood,
    budget,
    fast_learner: hasFastLearner,
    obtained_skills: obtainedSkillIds.map((id) => ({ skill_id: Number.parseInt(id, 10) || 0 })),
    candidate_skills: candidates.map((c) => ({
      skill_id: Number.parseInt(c.skillId, 10) || 0,
      hint_level: c.hintLevel
    }))
  };
}

// --- Import: encoding data → store-compatible shapes ---

export type ImportedPlannerData = {
  runner: Partial<IRunnerState>;
  obtainedSkillIds: Array<string>;
  candidates: Array<{ skillId: string; hintLevel: HintLevel }>;
  budget: number;
  hasFastLearner: boolean;
};

export function exportDataToImport(data: SkillPlannerExportData): ImportedPlannerData {
  const distanceMax = Math.max(
    data.proper_distance_short,
    data.proper_distance_mile,
    data.proper_distance_middle,
    data.proper_distance_long
  );
  const surfaceMax = Math.max(data.proper_ground_turf, data.proper_ground_dirt);
  const strategyMax = Math.max(
    data.proper_running_style_nige,
    data.proper_running_style_senko,
    data.proper_running_style_sashi,
    data.proper_running_style_oikomi
  );

  const strategy: IStrategyName = strategyValueToName[data.strategy as IStrategy] ?? 'Front Runner';

  return {
    runner: {
      outfitId: String(data.card_id),
      speed: data.speed,
      stamina: data.stamina,
      power: data.power,
      guts: data.guts,
      wisdom: data.wiz,
      distanceAptitude: encodingToAptitude(distanceMax),
      surfaceAptitude: encodingToAptitude(surfaceMax),
      strategyAptitude: encodingToAptitude(strategyMax),
      strategy,
      mood: data.mood as IRunnerState['mood'],
      skills: data.obtained_skills.map((s) => String(s.skill_id))
    },
    obtainedSkillIds: data.obtained_skills.map((s) => String(s.skill_id)),
    candidates: data.candidate_skills.map((s) => ({
      skillId: String(s.skill_id),
      hintLevel: s.hint_level
    })),
    budget: data.budget,
    hasFastLearner: data.fast_learner
  };
}
