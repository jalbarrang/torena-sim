import { useMemo } from 'react';
import { useShallow } from 'zustand/shallow';
import { coursesService } from '@/modules/data/services/CourseService';
import { skillsService } from '@/modules/data/services/SkillService';
import { useRunner } from '@/store/runners.store';
import { useSettingsStore } from '@/store/settings.store';
import { racedefToParams } from '@/utils/races';
import {
  type ActivatableSkillPool,
  getActivatableSkillsForRace
} from '@/modules/simulation/utils/skill-bassin-skills';

function useRaceSettingsKey() {
  const { courseId, racedef } = useSettingsStore(
    useShallow((state) => ({
      courseId: state.courseId,
      racedef: state.racedef
    }))
  );

  return useMemo(
    () =>
      `${courseId}-${racedef.ground}-${racedef.season}-${racedef.weather}-${racedef.time}-${racedef.grade}-${racedef.mood}`,
    [courseId, racedef]
  );
}

export function useActivatableSkillsForRace(pool: ActivatableSkillPool = 'base') {
  const { runner } = useRunner();
  const { courseId, racedef } = useSettingsStore(
    useShallow((state) => ({
      courseId: state.courseId,
      racedef: state.racedef
    }))
  );

  const raceOnlyKey = useRaceSettingsKey();

  const contextKey = useMemo(
    () => `${pool}-${raceOnlyKey}-${runner.strategy}-${runner.skills.join(',')}`,
    [pool, raceOnlyKey, runner.strategy, runner.skills]
  );

  const course = useMemo(() => coursesService.getSimCourse(courseId), [courseId]);

  const raceParams = useMemo(
    () => racedefToParams(racedef, runner.strategy),
    [racedef, runner.strategy]
  );

  const allSkills = useMemo(
    () => getActivatableSkillsForRace(runner, course, raceParams, pool),
    [runner, course, raceParams, pool]
  );

  const releasedIds = useMemo(
    () => new Set(allSkills.filter((s) => skillsService.isReleased(s.id)).map((s) => s.id)),
    [allSkills]
  );

  const releasedSkills = useMemo(
    () => allSkills.filter((s) => releasedIds.has(s.id)),
    [allSkills, releasedIds]
  );

  const upcomingSkills = useMemo(
    () => allSkills.filter((s) => !releasedIds.has(s.id)),
    [allSkills, releasedIds]
  );

  const releasedActivatableIds = useMemo(() => releasedSkills.map((s) => s.id), [releasedSkills]);

  return {
    raceSettingsKey: contextKey,
    raceOnlyKey,
    allSkills,
    releasedIds,
    releasedSkills,
    upcomingSkills,
    releasedActivatableIds
  };
}
