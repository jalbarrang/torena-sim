import type { RaceConditions } from '@/utils/races';
import type { IRunnerState } from '../runners/components/runner-card/domain/runner-state';
import type { CandidateSkill, SkillPlanningMeta } from './types';

export interface OptimizationInputFingerprintParams {
  courseId: number;
  racedef: RaceConditions;
  runner: IRunnerState;
  obtainedSkillIds: Array<string>;
  candidates: Record<string, CandidateSkill>;
  skillMetaById: Record<string, SkillPlanningMeta>;
  budget: number;
  hasFastLearner: boolean;
  ignoreStaminaConsumption: boolean;
  staminaDrainOverrides: Record<string, number>;
}

function toStableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => toStableValue(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const record = value as Record<string, unknown>;
  return Object.keys(record)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = toStableValue(record[key]);
      return acc;
    }, {});
}

export function buildOptimizationInputFingerprint(
  params: OptimizationInputFingerprintParams
): string {
  const candidateSnapshot = Object.values(params.candidates)
    .map((candidate) => ({
      skillId: candidate.skillId,
      hintLevel: candidate.hintLevel
    }))
    .toSorted((a, b) => a.skillId.localeCompare(b.skillId));

  const snapshot = {
    budget: params.budget,
    hasFastLearner: params.hasFastLearner,
    ignoreStaminaConsumption: params.ignoreStaminaConsumption,
    courseId: params.courseId,
    racedef: params.racedef,
    runner: params.runner,
    obtainedSkillIds: [...params.obtainedSkillIds].toSorted((a, b) => a.localeCompare(b)),
    candidates: candidateSnapshot,
    skillMetaById: params.skillMetaById,
    staminaDrainOverrides: params.staminaDrainOverrides
  };

  return JSON.stringify(toStableValue(snapshot));
}
