import type { ValueScalingDisplayContext } from '@/lib/uma-domain/skills/value-scaling/descriptor.types';
import { SkillItem } from '@/modules/skills/components/skill-list/skill-item/item';

import { useRunnerCardSkills } from '../../application/use-runner-card-skills';
import type { IRunnerState } from '../../domain/runner-state';
import { RunnerCardSkillHeader } from './skill-header';
import { RunnerCardSkillRow } from './skill-row';

type RunnerCardSkillsProps = {
  state: IRunnerState;
  onChange: (value: IRunnerState) => void;
  runnerId: string;
  courseDistance?: number;
  valueScalingContext?: ValueScalingDisplayContext;
  hideSkillButton: boolean;
  showSkillSpCosts: boolean;
  isMobile: boolean;
  skillHotkey?: string;
  onOpenSkillPicker?: () => void;
};

export function RunnerCardSkills(props: Readonly<RunnerCardSkillsProps>) {
  const { state, runnerId, courseDistance, valueScalingContext } = props;
  const skills = useRunnerCardSkills(props);

  return (
    <>
      <RunnerCardSkillHeader
        hideSkillButton={props.hideSkillButton}
        showSkillSpCosts={props.showSkillSpCosts}
        totalSkillSp={skills.totalSkillSp}
        hasFastLearner={skills.hasFastLearner}
        checkboxId={`${runnerId}-fast-learner`}
        skillHotkey={props.skillHotkey}
        isMobile={props.isMobile}
        onFastLearnerChange={skills.handleFastLearnerChange}
        onOpenSkillPicker={skills.handleOpenSkillPicker}
      />

      <div className="grid md:grid-cols-2 gap-2">
        {state.skills.map((skillId) => (
          <SkillItem
            key={skillId}
            skillId={skillId}
            valueScalingContext={valueScalingContext}
            distanceFactor={courseDistance}
            costSummary={skills.isCostEnabled ? skills.costSummaryBySkillId[skillId] : undefined}
            runnerId={skills.isCostEnabled ? runnerId : undefined}
            hasFastLearner={skills.isCostEnabled ? skills.hasFastLearner : undefined}
            onRemove={skills.handleRemoveSkill}
            onHintLevelChange={skills.isCostEnabled ? skills.handleHintLevelChange : undefined}
            onBoughtChange={skills.isCostEnabled ? skills.handleBoughtChange : undefined}
            getSkillMeta={skills.isCostEnabled ? skills.getSkillMetaForRunner : undefined}
          >
            <RunnerCardSkillRow
              dismissable={skillId !== skills.uniqueSkillId}
              inline={skills.isCostEnabled}
            />
          </SkillItem>
        ))}
      </div>
    </>
  );
}
