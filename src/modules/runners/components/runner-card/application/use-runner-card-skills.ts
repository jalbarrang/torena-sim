import { useCallback, useMemo } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';

import { openSkillPicker, updateCurrentSkills } from '@/modules/skills/store';
import { getSelectableSkillsForUma, getUniqueSkillForByUmaId } from '@/modules/skills/utils';

import { reconcileRunawayOnSkillsChange } from '../domain/runaway-policy';
import type { IRunnerState } from '../domain/runner-state';
import { useRunnerSkillCost } from './use-runner-skill-cost';

type UseRunnerCardSkillsArgs = {
  state: IRunnerState;
  onChange: (value: IRunnerState) => void;
  runnerId: string;
  showSkillSpCosts: boolean;
  isMobile: boolean;
  skillHotkey?: string;
  onOpenSkillPicker?: () => void;
};

export function useRunnerCardSkills(args: UseRunnerCardSkillsArgs) {
  const { state, onChange, runnerId, showSkillSpCosts, isMobile } = args;
  const { skillHotkey, onOpenSkillPicker } = args;
  const isCostEnabled = showSkillSpCosts && runnerId !== 'pacer';
  const cost = useRunnerSkillCost({ runnerId, skills: state.skills, enabled: isCostEnabled });
  const uniqueSkillId = useMemo(() => getUniqueSkillForByUmaId(state.outfitId), [state.outfitId]);

  const handleSetSkills = useCallback(
    (skills: Array<string>) => {
      const reconciled = reconcileRunawayOnSkillsChange(skills, state.strategy);
      onChange({ ...state, skills: reconciled.skills, strategy: reconciled.strategy });
      updateCurrentSkills(reconciled.skills);
    },
    [onChange, state]
  );

  const handleRemoveSkill = useCallback(
    (skillId: string) => handleSetSkills(state.skills.filter((id) => id !== skillId)),
    [handleSetSkills, state.skills]
  );

  const selectableSkills = useMemo(
    () => (onOpenSkillPicker ? [] : getSelectableSkillsForUma(state.outfitId, true)),
    [onOpenSkillPicker, state.outfitId]
  );

  const handleOpenSkillPicker = useCallback(() => {
    if (onOpenSkillPicker) return onOpenSkillPicker();
    openSkillPicker({
      runnerId: state.outfitId,
      umaId: state.outfitId,
      options: selectableSkills,
      currentSkills: state.skills,
      onSelect: handleSetSkills
    });
  }, [handleSetSkills, onOpenSkillPicker, selectableSkills, state.outfitId, state.skills]);

  useHotkeys(
    skillHotkey ?? '',
    (event) => {
      event.preventDefault();
      handleOpenSkillPicker();
    },
    { enabled: !!skillHotkey && !isMobile },
    [handleOpenSkillPicker]
  );

  return { ...cost, isCostEnabled, uniqueSkillId, handleRemoveSkill, handleOpenSkillPicker };
}
