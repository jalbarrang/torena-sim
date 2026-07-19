import { useMemo } from 'react';
import { Strategy, StrategyName, type IStrategyName } from '@/lib/uma-domain/runner/definitions';
import { countGuaranteedActivatedGreens } from '@/lib/uma-domain/skills/value-scaling/green-activation';
import { skillsService } from '@/modules/data/services/SkillService';
import { normalizeSkillIdForCostSummary } from '@/modules/skills/skill-cost-summary';
import { useSettingsStore } from '@/store/settings.store';
import { racedefToParams } from '@/utils/races';
import { coursesService } from '@/modules/data/services/CourseService';

type UseActivatedGreenCountArgs = {
  skillIds: ReadonlyArray<string>;
  strategy: IStrategyName;
  courseId: number;
};

function strategyForName(strategyName: IStrategyName): number | undefined {
  return Object.values(Strategy).find((strategy) => StrategyName[strategy] === strategyName);
}

export function useActivatedGreenCount(args: UseActivatedGreenCountArgs): number | undefined {
  const { skillIds, strategy, courseId } = args;
  const racedef = useSettingsStore((state) => state.racedef);

  return useMemo(() => {
    const strategyValue = strategyForName(strategy);
    if (strategyValue === undefined) {
      return undefined;
    }

    try {
      const skills = skillIds.flatMap((skillId) => {
        const skill = skillsService.getById(normalizeSkillIdForCostSummary(skillId));
        return skill ? [skill] : [];
      });

      return countGuaranteedActivatedGreens(skills, {
        runner: { strategy: strategyValue },
        course: coursesService.getSimCourse(courseId),
        raceParameters: racedefToParams(racedef)
      });
    } catch {
      return undefined;
    }
  }, [courseId, racedef, skillIds, strategy]);
}
