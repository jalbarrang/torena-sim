import { PlusIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

type RunnerCardSkillHeaderProps = {
  hideSkillButton: boolean;
  showSkillSpCosts: boolean;
  totalSkillSp: number | null;
  hasFastLearner: boolean;
  checkboxId: string;
  skillHotkey?: string;
  isMobile: boolean;
  onFastLearnerChange: (checked: boolean) => void;
  onOpenSkillPicker: () => void;
};

export function RunnerCardSkillHeader(props: Readonly<RunnerCardSkillHeaderProps>) {
  const {
    hideSkillButton,
    showSkillSpCosts,
    totalSkillSp,
    hasFastLearner,
    checkboxId,
    skillHotkey,
    isMobile,
    onFastLearnerChange,
    onOpenSkillPicker
  } = props;
  const showCosts = showSkillSpCosts && totalSkillSp !== null;
  const controls = showCosts ? (
    <>
      <span
        className={
          hideSkillButton
            ? 'text-xs text-muted-foreground'
            : 'text-xs font-semibold text-muted-foreground'
        }
      >
        {totalSkillSp} SP{hideSkillButton ? '' : ' needed'}
      </span>
      <div className="flex items-center gap-1.5 font-normal">
        <Checkbox
          id={checkboxId}
          checked={hasFastLearner}
          onCheckedChange={(checked) => onFastLearnerChange(checked === true)}
        />
        <Label htmlFor={checkboxId} className="text-xs text-muted-foreground">
          Fast Learner
        </Label>
      </div>
    </>
  ) : null;

  if (hideSkillButton) {
    return (
      <div className="text-sm font-semibold flex items-center gap-2">
        <span>Skills</span>
        {controls}
      </div>
    );
  }

  return (
    <div data-tutorial="skills-section" className="flex items-center gap-2">
      <div className="bg-card py-1 px-2 border font-bold rounded-lg flex-1 text-center h-auto flex items-center gap-4">
        <span>Skills</span>
        {controls}
      </div>
      <Button variant="default" onClick={onOpenSkillPicker} className="cursor-pointer">
        Add Skills
        <PlusIcon />
        {skillHotkey && !isMobile && (
          <kbd className="ml-1 inline-block rounded border border-primary-foreground/30 bg-primary-foreground/10 px-1 text-[0.65rem] font-medium leading-none">
            {skillHotkey.toUpperCase()}
          </kbd>
        )}
      </Button>
    </div>
  );
}
