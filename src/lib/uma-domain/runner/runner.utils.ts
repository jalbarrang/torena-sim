import { Region, RegionList } from '../shared/region';
import { ImmediatePolicy } from '../skills/policies/ActivationSamplePolicy';
import type { ISkillRarity, ISkillType } from '../skills/definitions';
import type { RaceParameters } from '../race/types';
import type { CourseData } from '../course/definitions';
import type { DefaultParser, SkillEvalRunner } from '../skills/parser/definitions';
import type { SkillAlternative, SkillEffect, SkillTrigger } from '../skills/skill.types';
import { skillsService } from '@/modules/data/services/SkillService';

export type BuildSkillDataParams = {
  runner: SkillEvalRunner;
  raceParams: RaceParameters;
  course: CourseData;
  wholeCourse: RegionList;
  parser: DefaultParser;
  skillId: string;
  ignoreNullEffects?: boolean;
};

/**
 * Build the skill effects for a given skill and perspective
 *
 * Note: we removed isTarget call as skill targeting will be direct inside of the RaceSimulator and Runner entities.
 */
function buildSkillEffects(skill: SkillAlternative) {
  const effects: Array<SkillEffect> = [];

  for (const effect of skill.effects) {
    effects.push({
      type: effect.type as ISkillType,
      baseDuration: skill.baseDuration / 10000,
      modifier: effect.modifier / 10000,
      target: effect.target,
      valueUsage: effect.valueUsage,
      valueLevelUsage: effect.valueLevelUsage
    });
  }

  return effects;
}

export function buildSkillData(params: BuildSkillDataParams): Array<SkillTrigger> {
  const {
    runner,
    raceParams,
    course,
    wholeCourse,
    parser,
    skillId,
    ignoreNullEffects = false
  } = params;

  const [baseSkillId] = skillId.split('-');
  if (!baseSkillId) {
    throw new Error('bad skill ID ' + skillId);
  }

  const skill = skillsService.getById(baseSkillId);

  if (!skill) {
    throw new Error('bad skill ID ' + skillId);
  }

  // Guard: skip skills with unparseable conditions rather than crashing the
  // entire simulation. This can happen with upcoming/datamined skills that
  // use condition tokens not yet implemented in the engine.
  if (!skillsService.isSimulatable(baseSkillId)) {
    if (import.meta.env?.DEV) {
      console.warn(
        `[buildSkillData] Skipping non-simulatable skill ${skillId}:`,
        skillsService.getUnsupportedTokens(baseSkillId)
      );
    }
    return [];
  }

  const extra = Object.assign({ skillId }, raceParams);

  const alternatives = skill.alternatives;
  const triggers: Array<SkillTrigger> = [];

  for (let i = 0; i < alternatives.length; ++i) {
    const skillAlternative = alternatives[i];

    if (skillAlternative.condition === '') {
      continue;
    }

    let full = new RegionList();
    for (const r of wholeCourse) full.push(r);

    if (skillAlternative.precondition) {
      const parsedPrecondition = parser.parse(skillAlternative.precondition);

      const preRegions = parsedPrecondition.apply({
        regions: wholeCourse,
        course,
        runner,
        extra
      })[0];

      if (preRegions.length == 0) {
        continue;
      }

      const bounds = new Region(preRegions[0].start, wholeCourse[wholeCourse.length - 1].end);

      full = full.rmap((r) => r.intersect(bounds));
    }

    const parsedOperator = parser.parse(skillAlternative.condition);

    const [regions, extraCondition] = parsedOperator.apply({
      regions: full,
      course,
      runner,
      extra
    });

    if (regions.length === 0) {
      continue;
    }

    if (
      triggers.length > 0 &&
      !/is_activate_other_skill_detail|is_used_skill_id/.test(skillAlternative.condition)
    ) {
      // i don't like this at all. the problem is some skills with two triggers (for example all the is_activate_other_skill_detail ones)
      // need to place two triggers so the second effect can activate, however, some other skills with two triggers only ever activate one
      // even if they have non-mutually-exclusive conditions (for example Jungle Pocket unique). i am not currently sure what distinguishes
      // them in the game implementation. it's pretty inconsistent about whether double-trigger skills force the conditions to be mutually
      // exclusive or not even if it only wants one of them to activate; for example Daitaku Helios unique ensures the distance conditions
      // are mutually exclusive for both triggers but Jungle Pocket doesn't. for the time being we're only going to place the first trigger
      // unless the second one is explicitly is_activate_other_skill_detail or is_used_skill_id (need this for NY Ace).
      // !!! FIXME this is actually bugged for NY Ace unique since she'll get both effects if she uses oonige.
      continue;
    }

    const effects = buildSkillEffects(skillAlternative);

    if (effects.length > 0 || ignoreNullEffects) {
      const rarity = skill.rarity;

      triggers.push({
        skillId: skillId,
        // for some reason 1*/2* uniques, 1*/2* upgraded to 3*, and naturally 3* uniques all have different rarity (3, 4, 5 respectively)
        rarity: rarity >= 3 && rarity <= 5 ? 3 : (rarity as ISkillRarity),
        samplePolicy: parsedOperator.samplePolicy,
        regions: regions,
        extraCondition: extraCondition,
        effects: effects
      });
    }
  }

  if (triggers.length > 0) {
    return triggers;
  }

  // if we get here, it means that no alternatives have their conditions satisfied for this course/horse.
  // however, for purposes of summer goldship unique (Adventure of 564), we still have to add something, since
  // that could still cause them to activate. so just add the first alternative at a location after the course
  // is over with a constantly false dynamic condition so that it never activates normally.
  const effects = buildSkillEffects(alternatives[0]);

  if (effects.length == 0 && !ignoreNullEffects) {
    return [];
  }

  const rarity = skill.rarity;
  const afterEnd = new RegionList();
  afterEnd.push(new Region(9999, 9999));

  return [
    {
      skillId: skillId,
      rarity: rarity >= 3 && rarity <= 5 ? 3 : (rarity as ISkillRarity),
      samplePolicy: ImmediatePolicy,
      regions: afterEnd,
      extraCondition: (_) => false,
      effects: effects
    }
  ];
}
