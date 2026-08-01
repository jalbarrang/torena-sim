import { strategyNames } from '@/lib/uma-domain/runner/definitions';
import { aptitudesFromInnate, collapsedFromBuckets } from '@/modules/runners/aptitude-buckets';
import type { ExtractedUmaData } from '@/modules/runners/ocr/types';
import { getUniqueSkillForByUmaId } from '@/modules/skills/utils';
import { skillsService } from '@/modules/data/services/SkillService';
import { umasService } from '@/modules/data/services/UmaService';

import type { IRunnerState } from '../domain/runner-state';

/** Builds imported runner state and returns any skills to sync with the picker store. */
export function buildOcrImportState(
  state: IRunnerState,
  data: ExtractedUmaData
): { next: IRunnerState; syncSkills: Array<string> | null } {
  const newState: Partial<IRunnerState> = {};

  if (data.outfitId) {
    newState.outfitId = data.outfitId;
  }

  if (data.speed) newState.speed = data.speed;
  if (data.stamina) newState.stamina = data.stamina;
  if (data.power) newState.power = data.power;
  if (data.guts) newState.guts = data.guts;
  if (data.wisdom) newState.wisdom = data.wisdom;

  if (data.surfaceAptitude) newState.surfaceAptitude = data.surfaceAptitude;
  if (data.distanceAptitude) newState.distanceAptitude = data.distanceAptitude;
  if (data.strategyAptitude) newState.strategyAptitude = data.strategyAptitude;
  if (data.strategy && strategyNames.includes(data.strategy)) {
    newState.strategy = data.strategy;
  }

  // Full 10-bucket aptitudes take priority: store them and derive the three
  // collapsed grades (course-agnostic max) so the coarse view stays consistent.
  if (data.aptitudes) {
    newState.aptitudes = data.aptitudes;
    const strategy = newState.strategy ?? state.strategy;
    Object.assign(newState, collapsedFromBuckets(data.aptitudes, strategy));
  }

  let syncSkills: Array<string> | null = null;

  if (data.skills && data.skills.length > 0) {
    const skillIds = data.skills.map((s) => s.id);

    // Add the unique skill for the uma if we detected one
    if (data.outfitId) {
      const uniqueSkillId = getUniqueSkillForByUmaId(data.outfitId);
      if (!skillIds.includes(uniqueSkillId)) {
        skillIds.unshift(uniqueSkillId);
      }
    }

    newState.skills = skillIds;
    syncSkills = skillIds;
  }

  return { next: { ...state, ...newState }, syncSkills };
}

/** Changes the outfit while retaining eligible skills and applying innate aptitudes. */
export function buildRunnerChangeState(
  state: IRunnerState,
  outfitId: string,
  courseId: number | undefined
): IRunnerState {
  const newSkills: Array<string> = [];

  for (const skillId of state.skills) {
    const skillData = skillsService.getById(skillId);

    if (skillData?.rarity && skillData.rarity < 3) {
      newSkills.push(skillId);
    }
  }

  if (outfitId) {
    // Add the unique skill for the uma at the beginning of the list
    newSkills.unshift(getUniqueSkillForByUmaId(outfitId));
  }

  const innate = outfitId ? umasService.getByOutfitId(outfitId)?.aptitudes[outfitId] : undefined;

  if (innate) {
    const aptitudes = aptitudesFromInnate(innate);
    const collapsed = collapsedFromBuckets(aptitudes, state.strategy, courseId);
    return { ...state, outfitId, skills: newSkills, aptitudes, ...collapsed };
  }

  return { ...state, outfitId, skills: newSkills };
}
