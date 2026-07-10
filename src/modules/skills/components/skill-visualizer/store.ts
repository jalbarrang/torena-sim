import { create } from 'zustand';
import { getDefaultCourseId } from '@/store/race/defaults';

export const MAX_VISUALIZED_SKILLS = 10;

type SkillVisualizerStore = {
  skillIds: Array<string>;
  courseId: number;
  focusedSkillId: string | null;
};

export const useSkillVisualizerStore = create<SkillVisualizerStore>(() => ({
  skillIds: [],
  courseId: getDefaultCourseId(),
  focusedSkillId: null
}));

export const toggleVisualizedSkill = (skillId: string) => {
  useSkillVisualizerStore.setState((state) => {
    if (state.skillIds.includes(skillId)) {
      return {
        skillIds: state.skillIds.filter((id) => id !== skillId),
        focusedSkillId: state.focusedSkillId === skillId ? null : state.focusedSkillId
      };
    }

    if (state.skillIds.length >= MAX_VISUALIZED_SKILLS) {
      return state;
    }

    return { skillIds: [...state.skillIds, skillId] };
  });
};

export const setVisualizedSkills = (skillIds: Array<string>) => {
  useSkillVisualizerStore.setState((state) => {
    const next = skillIds.slice(0, MAX_VISUALIZED_SKILLS);
    return {
      skillIds: next,
      focusedSkillId:
        state.focusedSkillId && next.includes(state.focusedSkillId) ? state.focusedSkillId : null
    };
  });
};

export const removeVisualizedSkill = (skillId: string) => {
  useSkillVisualizerStore.setState((state) => ({
    skillIds: state.skillIds.filter((id) => id !== skillId),
    focusedSkillId: state.focusedSkillId === skillId ? null : state.focusedSkillId
  }));
};

export const clearVisualizedSkills = () => {
  useSkillVisualizerStore.setState({ skillIds: [], focusedSkillId: null });
};

export const toggleFocusedVisualizedSkill = (skillId: string) => {
  useSkillVisualizerStore.setState((state) => ({
    focusedSkillId: state.focusedSkillId === skillId ? null : skillId
  }));
};

export const setVisualizerCourseId = (courseId: number) => {
  useSkillVisualizerStore.setState({ courseId });
};
