import React, { useMemo } from 'react';
import { skillsService } from '@/modules/data/services/SkillService';
import { normalizeSkillIdForCostSummary } from '@/modules/skills/skill-cost-summary';
import { isUniqueSkill } from '@/store/runners.store';
import {
  defaultGetSkillMeta,
  SkillItemContext,
  type SkillItemContextValue,
  type SkillMeta
} from './context';
import type { SkillItemContextProps } from './types';

export type SkillItemProviderProps = React.PropsWithChildren<SkillItemContextProps>;

export function SkillItemProvider(props: Readonly<SkillItemProviderProps>) {
  const {
    children,
    skillId,
    valueScalingContext,
    hasFastLearner,
    spCost,
    runnerId,
    distanceFactor,
    costSummary,
    onHintLevelChange,
    onBoughtChange,
    onRemove,
    getSkillMeta
  } = props;
  const normalizedSkillId = useMemo(() => normalizeSkillIdForCostSummary(skillId), [skillId]);

  const skill = useMemo(() => {
    const s = skillsService.getById(normalizedSkillId);
    if (!s) throw new Error(`Skill not found: ${normalizedSkillId}`);
    return s;
  }, [normalizedSkillId]);

  const hasCost = useMemo(() => {
    const supportsPurchasableCost = !isUniqueSkill(skill.rarity);

    if (!supportsPurchasableCost) {
      return false;
    }

    return Boolean(costSummary) || typeof spCost === 'number';
  }, [costSummary, spCost, skill.rarity]);

  const resolvedGetSkillMeta = useMemo(() => {
    const sourceGetSkillMeta = getSkillMeta ?? defaultGetSkillMeta;

    return (targetSkillId: string): SkillMeta => {
      const directMeta = sourceGetSkillMeta(targetSkillId);
      const normalizedTargetSkillId = normalizeSkillIdForCostSummary(targetSkillId);

      if (
        normalizedTargetSkillId === targetSkillId ||
        directMeta.hintLevel !== 0 ||
        directMeta.bought !== undefined
      ) {
        return directMeta;
      }

      const fallbackMeta = sourceGetSkillMeta(normalizedTargetSkillId);

      if (fallbackMeta.hintLevel !== 0 || fallbackMeta.bought !== undefined) {
        return fallbackMeta;
      }

      return directMeta;
    };
  }, [getSkillMeta]);

  const contextValue = useMemo<SkillItemContextValue>(() => {
    return {
      skill,
      skillId,
      normalizedSkillId,
      valueScalingContext,
      hasFastLearner: hasFastLearner ?? false,
      hasCost,
      runnerId,
      distanceFactor,
      spCost,
      costSummary,
      onHintLevelChange,
      onBoughtChange,
      onRemove,
      getSkillMeta: resolvedGetSkillMeta
    };
  }, [
    skill,
    skillId,
    normalizedSkillId,
    valueScalingContext,
    hasFastLearner,
    hasCost,
    runnerId,
    distanceFactor,
    spCost,
    costSummary,
    onHintLevelChange,
    onBoughtChange,
    onRemove,
    resolvedGetSkillMeta
  ]);

  return <SkillItemContext.Provider value={contextValue}>{children}</SkillItemContext.Provider>;
}
