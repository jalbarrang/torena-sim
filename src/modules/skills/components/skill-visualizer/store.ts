import { create } from 'zustand';
import { getDefaultCourseId } from '@/store/race/defaults';

export const MAX_VISUALIZED_SKILLS = 10;

type SkillVisualizerStore = {
  skillIds: Array<string>;
  courseId: number;
};

export const useSkillVisualizerStore = create<SkillVisualizerStore>(() => ({
  skillIds: [],
  courseId: getDefaultCourseId()
}));

export const toggleVisualizedSkill = (skillId: string) => {
  useSkillVisualizerStore.setState((state) => {
    if (state.skillIds.includes(skillId)) {
      return { skillIds: state.skillIds.filter((id) => id !== skillId) };
    }

    if (state.skillIds.length >= MAX_VISUALIZED_SKILLS) {
      return state;
    }

    return { skillIds: [...state.skillIds, skillId] };
  });
};

export const setVisualizedSkills = (skillIds: Array<string>) => {
  useSkillVisualizerStore.setState({ skillIds: skillIds.slice(0, MAX_VISUALIZED_SKILLS) });
};

export const removeVisualizedSkill = (skillId: string) => {
  useSkillVisualizerStore.setState((state) => ({
    skillIds: state.skillIds.filter((id) => id !== skillId)
  }));
};

export const clearVisualizedSkills = () => {
  useSkillVisualizerStore.setState({ skillIds: [] });
};

export const setVisualizerCourseId = (courseId: number) => {
  useSkillVisualizerStore.setState({ courseId });
};
