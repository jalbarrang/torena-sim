import { coursesService } from '@/modules/data/services/CourseService';
import { skillsService } from '@/modules/data/services/SkillService';
import { MAX_VISUALIZED_SKILLS } from './store';

export const VISUALIZER_SKILLS_PARAM = 'skills';
export const VISUALIZER_COURSE_PARAM = 'course';

export type VisualizerShareState = {
  skillIds: Array<string>;
  courseId: number | null;
};

/**
 * Parses visualizer deep-link params. Returns null when neither param is present so callers can
 * tell "no link" apart from "link with nothing valid in it". Unknown skill IDs and courses are
 * dropped rather than failing the whole import.
 */
export function parseVisualizerShareParams(params: URLSearchParams): VisualizerShareState | null {
  const rawSkills = params.get(VISUALIZER_SKILLS_PARAM);
  const rawCourse = params.get(VISUALIZER_COURSE_PARAM);

  if (rawSkills === null && rawCourse === null) {
    return null;
  }

  const skillIds: Array<string> = [];
  if (rawSkills !== null) {
    for (const part of rawSkills.split(',')) {
      const skillId = part.trim();
      if (!skillId || skillIds.includes(skillId)) continue;
      if (!skillsService.getById(skillId)) continue;

      skillIds.push(skillId);
      if (skillIds.length >= MAX_VISUALIZED_SKILLS) break;
    }
  }

  let courseId: number | null = null;
  if (rawCourse !== null) {
    const parsed = Number(rawCourse);
    if (Number.isInteger(parsed) && coursesService.getById(String(parsed))) {
      courseId = parsed;
    }
  }

  return { skillIds, courseId };
}

export function buildVisualizerShareParams(
  skillIds: Array<string>,
  courseId: number
): URLSearchParams {
  const params = new URLSearchParams();
  if (skillIds.length > 0) {
    params.set(VISUALIZER_SKILLS_PARAM, skillIds.join(','));
  }
  params.set(VISUALIZER_COURSE_PARAM, String(courseId));
  return params;
}
