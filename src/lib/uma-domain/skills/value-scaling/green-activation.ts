import type { CourseData } from '@/lib/uma-domain/course/definitions';
import type { RaceParameters } from '@/lib/uma-domain/race/types';
import { Region, RegionList } from '@/lib/uma-domain/shared/region';
import { kTrue } from '../parser/conditions/utils';
import { createParser } from '../parser/ConditionParser';
import { defaultConditions } from '../parser/conditions/conditions';
import type { ApplyParams, SkillEvalRunner } from '../parser/definitions';

type GreenSkillLike = {
  tags: ReadonlyArray<number>;
  alternatives: ReadonlyArray<{ condition: string; precondition?: string }>;
};

export type GreenActivationContext = {
  runner: SkillEvalRunner;
  course: CourseData;
  raceParameters: RaceParameters;
};

function hasGreenTag(skill: GreenSkillLike): boolean {
  return skill.tags.some((tag) => tag >= 601 && tag <= 615);
}

function applyParams(context: GreenActivationContext): ApplyParams {
  return {
    regions: new RegionList(new Region(0, context.course.distance)),
    course: context.course,
    runner: context.runner,
    extra: context.raceParameters
  };
}

function isGuaranteedAlternative(
  alternative: GreenSkillLike['alternatives'][number],
  context: GreenActivationContext
): boolean {
  if (!alternative.condition) return false;

  const parser = createParser({ conditions: defaultConditions });
  try {
    if (alternative.precondition) {
      const [regions, dynamic] = parser.parse(alternative.precondition).apply(applyParams(context));
      if (regions.length === 0 || dynamic !== kTrue) return false;
    }

    const [regions, dynamic] = parser.parse(alternative.condition).apply(applyParams(context));
    return regions.length > 0 && dynamic === kTrue;
  } catch {
    return false;
  }
}

/** Count green skills whose parser-evaluated gate is fully static and passes for this race. */
export function countGuaranteedActivatedGreens(
  skills: ReadonlyArray<GreenSkillLike>,
  context: GreenActivationContext
): number {
  return skills.filter(
    (skill) =>
      hasGreenTag(skill) && skill.alternatives.some((alt) => isGuaranteedAlternative(alt, context))
  ).length;
}
