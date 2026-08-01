import type { CourseData } from '@/lib/uma-domain/course/definitions';
import type { RaceParameters } from '@/lib/uma-domain/race/types';
import { skillsService } from '@/modules/data/services/SkillService';
import type { SkillEntry } from '@/modules/data/services/SkillService';
import type { IRunnerState } from '@/modules/runners/components/runner-card/domain/runner-state';
import { getBaseSkillsToTest } from '@/modules/skills/utils';

export type ActivatableSkillPool = 'base' | 'unique';

function sortSkills(a: SkillEntry, b: SkillEntry): number {
  if (!a.releaseDate || !b.releaseDate) return 0;

  const dateCmp = a.releaseDate.localeCompare(b.releaseDate);

  if (dateCmp !== 0) return dateCmp;

  return a.name.localeCompare(b.name);
}

function getCandidateSkillIdsForPool(
  runner: IRunnerState,
  pool: ActivatableSkillPool
): Array<string> {
  if (pool === 'unique') {
    return skillsService.getUniqueSkillIds();
  }

  const baseSkillsToTest = getBaseSkillsToTest();

  return baseSkillsToTest.filter(
    (skillId) =>
      !runner.skills.includes(skillId) &&
      (!skillId.startsWith('9') || !runner.skills.includes('1' + skillId.slice(1)))
  );
}

function getActivatableSkillIdsForRace(
  runner: IRunnerState,
  course: CourseData,
  raceParams: RaceParameters,
  pool: ActivatableSkillPool = 'base'
): Array<string> {
  const filterer = skillsService.createFilterer({ runner, course, raceParams });
  const candidateSkills = getCandidateSkillIdsForPool(runner, pool);
  const candidates = filterer.filterCandidates(candidateSkills);

  return filterer.probeActivation(candidates);
}

export function getActivatableSkillsForRace(
  runner: IRunnerState,
  course: CourseData,
  raceParams: RaceParameters,
  pool: ActivatableSkillPool = 'base'
): Array<SkillEntry> {
  const activatableIds = getActivatableSkillIdsForRace(runner, course, raceParams, pool);

  return activatableIds
    .map((id) => skillsService.getById(id))
    .filter((s): s is SkillEntry => s !== undefined)
    .sort(sortSkills);
}
