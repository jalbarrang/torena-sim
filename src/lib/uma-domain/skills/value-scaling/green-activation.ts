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

const parser = createParser({ conditions: defaultConditions });

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

/**
 * A gate condition is *guaranteed* when its static evaluation passes with no
 * dynamic gate AND its regions still cover the gate (start 0). Requiring the
 * gate keeps this a conservative floor: a hypothetical green whose condition
 * narrows to a later region (e.g. `phase>=2`) might activate after the
 * usage-14 carrier procs, so it must not be promised.
 */
function isGuaranteedAlternative(
  alternative: GreenSkillLike['alternatives'][number],
  context: GreenActivationContext
): boolean {
  if (!alternative.condition) return false;

  const coversGate = (regions: RegionList) => regions.length > 0 && regions[0].start === 0;
  try {
    if (alternative.precondition) {
      const [regions, dynamic] = parser.parse(alternative.precondition).apply(applyParams(context));
      if (!coversGate(regions) || dynamic !== kTrue) return false;
    }

    const [regions, dynamic] = parser.parse(alternative.condition).apply(applyParams(context));
    return coversGate(regions) && dynamic === kTrue;
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
