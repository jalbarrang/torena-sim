import { create } from 'zustand';

type UmaSkillSelectionState = {
  selectedSkillIds: Set<string>;
  lastActivatableIds: Set<string> | null;
};

export const useUmaSkillSelectionStore = create<UmaSkillSelectionState>()(() => ({
  selectedSkillIds: new Set<string>(),
  lastActivatableIds: null
}));

export const resetUmaSkillSelectionForRace = (releasedActivatableIds: Array<string>) => {
  useUmaSkillSelectionStore.setState({
    selectedSkillIds: new Set(releasedActivatableIds),
    lastActivatableIds: new Set(releasedActivatableIds)
  });
};

export const reconcileUmaSkillSelectionForPool = (activatableIds: Array<string>) => {
  useUmaSkillSelectionStore.setState((state) => {
    if (state.lastActivatableIds === null) {
      return {
        selectedSkillIds: new Set(activatableIds),
        lastActivatableIds: new Set(activatableIds)
      };
    }

    const selectedSkillIds = new Set(
      activatableIds.filter(
        (id) => state.selectedSkillIds.has(id) || !state.lastActivatableIds?.has(id)
      )
    );

    return {
      selectedSkillIds,
      lastActivatableIds: new Set(activatableIds)
    };
  });
};

export const toggleUmaSkillSelected = (skillId: string) => {
  useUmaSkillSelectionStore.setState((state) => {
    const next = new Set(state.selectedSkillIds);

    if (next.has(skillId)) {
      next.delete(skillId);
    } else {
      next.add(skillId);
    }

    return { selectedSkillIds: next };
  });
};

export const selectAllUmaSkills = (skillIds: Array<string>) => {
  useUmaSkillSelectionStore.setState((state) => {
    const next = new Set(state.selectedSkillIds);

    for (const id of skillIds) {
      next.add(id);
    }

    return { selectedSkillIds: next };
  });
};

export const deselectAllUmaSkills = (skillIds: Array<string>) => {
  useUmaSkillSelectionStore.setState((state) => {
    const next = new Set(state.selectedSkillIds);

    for (const id of skillIds) {
      next.delete(id);
    }

    return { selectedSkillIds: next };
  });
};
