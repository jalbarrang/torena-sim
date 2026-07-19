import { useCallback, useMemo, useRef } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';

import { PlusIcon } from 'lucide-react';
import type { ValueScalingDisplayContext } from '@/lib/uma-domain/skills/value-scaling/descriptor.types';
import { getUmaDisplayInfo, getUmaImageUrl } from '@/modules/runners/utils';
import { StatsTable } from './stats-table';
import { AptitudeBucketsField } from '@/modules/runners/components/aptitude-buckets-field';
import { reconcileRunawayOnSkillsChange } from './types';
import type { IRunnerState } from './types';
import type { StatsKey } from './stats-table';
import type { ExtractedUmaData } from '@/modules/runners/ocr/types';
import { SkillItem } from '@/modules/skills/components/skill-list/skill-item/item';

import { getSelectableSkillsForUma, getUniqueSkillForByUmaId } from '@/modules/skills/utils';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useIsMobile } from '@/hooks/use-mobile';
import { openSkillPicker, updateCurrentSkills } from '@/modules/skills/store';
import { cn } from '@/lib/utils';
import { useRunnerSkillCost } from './use-runner-skill-cost';
import { getSkillsForShareCard } from '../../share/share-actions';
import { ShareCard } from '../../share/share-card';
import { RunnerCardActions } from './runner-card-actions';
import { RunnerCardSkillRow } from './skill-row';
import { buildOcrImportState, buildRunnerChangeState } from './runner-card.mutations';

type RunnerCardProps = {
  value: IRunnerState;
  courseDistance?: number;
  runnerId: string;
  valueScalingContext?: ValueScalingDisplayContext;

  // Events
  onChange: (value: IRunnerState) => void;
  onReset?: () => void;
  onCopy?: () => void;
  onSwap?: () => void;
  onOpenSkillPicker?: () => void;

  // Options
  hideSkillButton?: boolean;
  showSkillSpCosts?: boolean;
  showShareButton?: boolean;
  courseId?: number;
  showStrategyMood?: boolean;
  /** Bare keyboard shortcut (e.g. "k") to open the skill picker. Desktop only. */
  skillHotkey?: string;
};

export const RunnerCard = (props: RunnerCardProps) => {
  const {
    value: state,
    onChange,
    onReset,
    onCopy,
    onOpenSkillPicker,
    hideSkillButton = false,
    showSkillSpCosts = false,
    showShareButton = true,
    courseId,
    showStrategyMood = true,
    skillHotkey,
    valueScalingContext
  } = props;

  const isMobile = useIsMobile();

  const umaId = state.outfitId;

  const shareCardRef = useRef<HTMLDivElement>(null);

  const umaInfo = useMemo(() => {
    if (!umaId) return null;
    return getUmaDisplayInfo(umaId);
  }, [umaId]);

  const shareImageUrl = useMemo(() => {
    return getUmaImageUrl(umaId, state.randomMobId);
  }, [umaId, state.randomMobId]);

  const shareSkills = useMemo(() => {
    return getSkillsForShareCard(state.skills);
  }, [state.skills]);

  const handleSetSkills = useCallback(
    (skills: Array<string>) => {
      const reconciled = reconcileRunawayOnSkillsChange(skills, state.strategy);
      onChange({ ...state, skills: reconciled.skills, strategy: reconciled.strategy });
      updateCurrentSkills(reconciled.skills);
    },
    [onChange, state]
  );

  const handleOcrImportApply = useCallback(
    (data: ExtractedUmaData) => {
      const { next, syncSkills } = buildOcrImportState(state, data);
      if (syncSkills) updateCurrentSkills(syncSkills);
      onChange(next);
    },
    [onChange, state]
  );

  const handleChangeRunner = useCallback(
    (outfitId: string) => {
      onChange(buildRunnerChangeState(state, outfitId, courseId));
    },
    [onChange, state, courseId]
  );

  const handleUpdateStat = (prop: StatsKey) => (value: number) => {
    onChange({ ...state, [prop]: value });
  };

  const umaUniqueSkillId = useMemo(() => getUniqueSkillForByUmaId(umaId), [umaId]);

  const isSkillSpCostEnabled = showSkillSpCosts && props.runnerId !== 'pacer';

  const {
    hasFastLearner,
    costSummaryBySkillId,
    totalSkillSp,
    handleFastLearnerChange,
    handleHintLevelChange,
    handleBoughtChange,
    getSkillMetaForRunner
  } = useRunnerSkillCost({
    runnerId: props.runnerId,
    skills: state.skills,
    enabled: isSkillSpCostEnabled
  });

  const fastLearnerCheckboxId = `${props.runnerId}-fast-learner`;

  const handleRemoveSkill = useCallback(
    (skillId: string) => {
      handleSetSkills(state.skills.filter((id) => id !== skillId));
    },
    [handleSetSkills, state.skills]
  );

  const selectableSkills = useMemo(() => {
    if (onOpenSkillPicker) {
      return [];
    }

    return getSelectableSkillsForUma(umaId, true);
  }, [umaId, onOpenSkillPicker]);

  const handleOpenSkillPicker = useCallback(() => {
    if (onOpenSkillPicker) {
      onOpenSkillPicker();
      return;
    }

    openSkillPicker({
      runnerId: umaId,
      umaId: umaId,
      options: selectableSkills,
      currentSkills: state.skills,
      onSelect: handleSetSkills
    });
  }, [umaId, selectableSkills, state.skills, handleSetSkills, onOpenSkillPicker]);

  // Desktop-only bare keyboard shortcut to open the skill picker.
  // `enableOnFormTags` defaults to false, so it won't fire while typing in a field.
  useHotkeys(
    skillHotkey ?? '',
    (event) => {
      event.preventDefault();
      handleOpenSkillPicker();
    },
    { enabled: !!skillHotkey && !isMobile },
    [handleOpenSkillPicker]
  );

  return (
    <div className="runner-card flex flex-col gap-4 p-2">
      <RunnerCardActions
        state={state}
        umaId={umaId}
        umaInfo={umaInfo}
        runnerId={props.runnerId}
        isMobile={isMobile}
        showShareButton={showShareButton}
        shareCardRef={shareCardRef}
        onChange={onChange}
        onChangeRunner={handleChangeRunner}
        onReset={onReset}
        onCopy={onCopy}
        onOcrApply={handleOcrImportApply}
      />

      <div className="flex flex-col gap-2" data-tutorial="runner-stats">
        <StatsTable value={state} onChange={handleUpdateStat} />

        <AptitudeBucketsField
          value={state}
          onChange={onChange}
          courseId={courseId}
          showStrategyMood={showStrategyMood}
        />
      </div>

      {!hideSkillButton && (
        <div data-tutorial="skills-section" className="flex items-center gap-2">
          <div className="bg-card py-1 px-2 border font-bold rounded-lg flex-1 text-center h-auto flex items-center gap-4">
            <span>Skills</span>

            {showSkillSpCosts && totalSkillSp !== null && (
              <>
                <span className="text-xs font-semibold text-muted-foreground">
                  {totalSkillSp} SP needed
                </span>
                <div className="flex items-center gap-1.5 font-normal">
                  <Checkbox
                    id={fastLearnerCheckboxId}
                    checked={hasFastLearner}
                    onCheckedChange={(checked) => handleFastLearnerChange(checked === true)}
                  />
                  <Label htmlFor={fastLearnerCheckboxId} className="text-xs text-muted-foreground">
                    Fast Learner
                  </Label>
                </div>
              </>
            )}
          </div>

          <Button variant="default" onClick={handleOpenSkillPicker} className="cursor-pointer">
            Add Skills
            <PlusIcon />
            {skillHotkey && !isMobile && (
              <kbd className="ml-1 inline-block rounded border border-primary-foreground/30 bg-primary-foreground/10 px-1 text-[0.65rem] font-medium leading-none">
                {skillHotkey.toUpperCase()}
              </kbd>
            )}
          </Button>
        </div>
      )}

      {hideSkillButton && (
        <div className="text-sm font-semibold flex items-center gap-2">
          <span>Skills</span>

          {showSkillSpCosts && totalSkillSp !== null && (
            <>
              <span className="text-xs text-muted-foreground">{totalSkillSp} SP</span>

              <div className="flex items-center gap-1.5 font-normal">
                <Checkbox
                  id={fastLearnerCheckboxId}
                  checked={hasFastLearner}
                  onCheckedChange={(checked) => handleFastLearnerChange(checked === true)}
                />
                <Label htmlFor={fastLearnerCheckboxId} className="text-xs text-muted-foreground">
                  Fast Learner
                </Label>
              </div>
            </>
          )}
        </div>
      )}

      <div className={cn('grid md:grid-cols-2 gap-2')}>
        {state.skills.map((skillId) => (
          <SkillItem
            key={skillId}
            skillId={skillId}
            valueScalingContext={valueScalingContext}
            distanceFactor={props.courseDistance}
            costSummary={isSkillSpCostEnabled ? costSummaryBySkillId[skillId] : undefined}
            runnerId={isSkillSpCostEnabled ? props.runnerId : undefined}
            hasFastLearner={isSkillSpCostEnabled ? hasFastLearner : undefined}
            onRemove={handleRemoveSkill}
            onHintLevelChange={isSkillSpCostEnabled ? handleHintLevelChange : undefined}
            onBoughtChange={isSkillSpCostEnabled ? handleBoughtChange : undefined}
            getSkillMeta={isSkillSpCostEnabled ? getSkillMetaForRunner : undefined}
          >
            <RunnerCardSkillRow
              dismissable={skillId !== umaUniqueSkillId}
              inline={isSkillSpCostEnabled}
            />
          </SkillItem>
        ))}
      </div>

      <div style={{ position: 'absolute', left: -9999, top: 0 }}>
        <ShareCard
          ref={shareCardRef}
          runner={state}
          umaInfo={umaInfo}
          imageUrl={shareImageUrl}
          skills={shareSkills}
        />
      </div>
    </div>
  );
};
