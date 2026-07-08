import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import {
  Panel,
  PanelContent,
  PanelDescription,
  PanelHeader,
  PanelTitle
} from '@/components/ui/panel';
import { buildRunnerSkillEntries, ForcedPositionGroup } from './ForcedPositionGroup';
import { useComparePairRunners } from '@/store/runners.store';
import { useComparePairNames } from '@/modules/runners/hooks/use-compare-names';
import {
  clearAllForcedPositions,
  useForcedPositions
} from '@/modules/simulation/stores/forced-positions.store';

export function ForcedPositionsPanel() {
  const { uma1: runnerA, uma2: runnerB } = useComparePairRunners();
  const uma1Skills = runnerA.skills;
  const uma2Skills = runnerB.skills;
  const { uma1, uma2 } = useForcedPositions();
  const names = useComparePairNames();

  const mappedSkills = useMemo(() => {
    return {
      uma1: buildRunnerSkillEntries(uma1Skills),
      uma2: buildRunnerSkillEntries(uma2Skills)
    };
  }, [uma1Skills, uma2Skills]);

  return (
    <Panel>
      <PanelHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <PanelTitle>Forced Skill Positions</PanelTitle>
            <PanelDescription>Override skill activation positions here.</PanelDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={clearAllForcedPositions}
            disabled={Object.keys(uma1).length === 0 && Object.keys(uma2).length === 0}
          >
            Clear all
          </Button>
        </div>
      </PanelHeader>

      <PanelContent className="flex flex-col gap-3">
        <ForcedPositionGroup
          runnerId="uma1"
          title={names.uma1}
          skills={mappedSkills.uma1}
          positions={uma1}
        />

        <ForcedPositionGroup
          runnerId="uma2"
          title={names.uma2}
          skills={mappedSkills.uma2}
          positions={uma2}
        />
      </PanelContent>
    </Panel>
  );
}
