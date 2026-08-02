import { AptitudeBucketsField } from '@/modules/runners/components/aptitude-buckets-field';

import { useRunnerCard } from './application/use-runner-card';
import { RunnerCardActions } from './presentation/actions/runner-card-actions';
import { RunnerCardSkills } from './presentation/skills/runner-card-skills';
import { RunnerCardSharePreview } from './presentation/share-preview';
import { StatsTable } from './presentation/stats-table';
import type { RunnerCardProps } from './runner-card.types';

export function RunnerCard(props: Readonly<RunnerCardProps>) {
  const {
    runnerId,
    courseDistance,
    valueScalingContext,
    onChange,
    onReset,
    onCopy,
    onOpenSkillPicker,
    hideSkillButton = false,
    showSkillSpCosts = false,
    showShareButton = true,
    courseId,
    showStrategyMood = true,
    skillHotkey
  } = props;
  const model = useRunnerCard(props);

  return (
    <div className="runner-card flex flex-col gap-4 p-2">
      <RunnerCardActions
        state={model.state}
        umaId={model.state.outfitId}
        umaInfo={model.umaInfo}
        runnerId={runnerId}
        isMobile={model.isMobile}
        showShareButton={showShareButton}
        shareCardRef={model.shareCardRef}
        onChangeRunner={model.handleChangeRunner}
        onReset={onReset}
        onCopy={onCopy}
        onOcrApply={model.handleOcrImportApply}
      />

      <div className="flex flex-col gap-2" data-tutorial="runner-stats">
        <StatsTable value={model.state} onChange={model.handleUpdateStat} />
        <AptitudeBucketsField
          value={model.state}
          onChange={onChange}
          courseId={courseId}
          showStrategyMood={showStrategyMood}
        />
      </div>

      <RunnerCardSkills
        state={model.state}
        onChange={onChange}
        runnerId={runnerId}
        courseDistance={courseDistance}
        valueScalingContext={valueScalingContext}
        hideSkillButton={hideSkillButton}
        showSkillSpCosts={showSkillSpCosts}
        isMobile={model.isMobile}
        skillHotkey={skillHotkey}
        onOpenSkillPicker={onOpenSkillPicker}
      />

      <RunnerCardSharePreview
        shareCardRef={model.shareCardRef}
        state={model.state}
        umaInfo={model.umaInfo}
      />
    </div>
  );
}
