import type { IStrategyName } from '@/lib/uma-domain/runner/definitions';

export const runawaySkillId = '202051' as const;

/** Keeps Runaway strategy and its required skill consistent after skill edits. */
export function reconcileRunawayOnSkillsChange(
  skills: Array<string>,
  strategy: IStrategyName
): { skills: Array<string>; strategy: IStrategyName } {
  const hasSkill = skills.includes(runawaySkillId);
  if (hasSkill && strategy === 'Front Runner') return { skills, strategy: 'Runaway' };
  if (!hasSkill && strategy === 'Runaway') return { skills, strategy: 'Front Runner' };
  return { skills, strategy };
}

/** Keeps Runaway strategy and its required skill consistent after strategy edits. */
export function reconcileRunawayOnStrategyChange(
  strategy: IStrategyName,
  skills: Array<string>
): { skills: Array<string>; strategy: IStrategyName } {
  const hasSkill = skills.includes(runawaySkillId);
  if (strategy === 'Runaway' && !hasSkill) {
    return { strategy, skills: [...skills, runawaySkillId] };
  }
  if (strategy === 'Front Runner' && hasSkill) return { strategy: 'Runaway', skills };
  return { strategy, skills };
}
