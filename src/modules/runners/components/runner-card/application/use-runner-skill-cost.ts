import { useCallback, useMemo } from 'react';

import type { SkillMeta } from '@/modules/skills/components/skill-list/skill-item/context';
import {
  setFastLearner,
  setHintLevel,
  setBought,
  useSkillCostMetaStore,
  useRunnerHasFastLearner,
  getSkillCostMeta,
  computeSkillCostSummary
} from '@/modules/skills/stores/skill-cost-meta.store';
import type { HintLevel } from '@/modules/skill-planner/types';
import {
  buildDedupedSkillListNetTotal,
  type SkillCostSummary
} from '@/modules/skills/skill-cost-summary';

type UseRunnerSkillCostArgs = {
  runnerId: string;
  skills: Array<string>;
  enabled: boolean;
};

export function useRunnerSkillCost(args: UseRunnerSkillCostArgs) {
  const { runnerId, skills, enabled } = args;

  const hasFastLearner = useRunnerHasFastLearner(enabled ? runnerId : '');
  const skillMetaByKey = useSkillCostMetaStore((s) => s.skillMetaByKey);

  const costSummaryBySkillId = useMemo<Record<string, SkillCostSummary>>(() => {
    if (!enabled) return {};

    const map: Record<string, SkillCostSummary> = {};
    for (const skillId of skills) {
      map[skillId] = computeSkillCostSummary(skillId, runnerId, skillMetaByKey, hasFastLearner);
    }

    return map;
  }, [enabled, runnerId, skills, skillMetaByKey, hasFastLearner]);

  const totalSkillSp = useMemo(() => {
    if (!enabled) return null;

    return buildDedupedSkillListNetTotal({
      visibleSkillIds: skills,
      hasFastLearner,
      getSkillMeta: (targetSkillId) => {
        const key = `${runnerId}:${targetSkillId}`;
        return skillMetaByKey[key] ?? { hintLevel: 0 };
      }
    });
  }, [enabled, skills, hasFastLearner, runnerId, skillMetaByKey]);

  const handleFastLearnerChange = useCallback(
    (checked: boolean) => {
      if (!enabled) return;
      setFastLearner(runnerId, checked);
    },
    [enabled, runnerId]
  );

  const handleHintLevelChange = useCallback(
    (skillId: string, level: number) => {
      if (!enabled) return;
      setHintLevel(runnerId, skillId, level as HintLevel);
    },
    [enabled, runnerId]
  );

  const handleBoughtChange = useCallback(
    (skillId: string, bought: boolean) => {
      if (!enabled) return;
      setBought(runnerId, skillId, bought);
    },
    [enabled, runnerId]
  );

  const getSkillMetaForRunner = useCallback(
    (skillId: string): SkillMeta => {
      if (!enabled) return { hintLevel: 0 };
      return getSkillCostMeta(runnerId, skillId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- skillMetaByKey triggers new ref so cost-details re-reads fresh data
    [enabled, runnerId, skillMetaByKey]
  );

  return {
    hasFastLearner,
    costSummaryBySkillId,
    totalSkillSp,
    handleFastLearnerChange,
    handleHintLevelChange,
    handleBoughtChange,
    getSkillMetaForRunner
  };
}
