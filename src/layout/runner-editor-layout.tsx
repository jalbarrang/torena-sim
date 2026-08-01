import { useMemo, useState } from 'react';
import { reconcileRunawayOnSkillsChange } from '@/modules/runners/components/runner-card/domain/runaway-policy';
import type { IRunnerState } from '@/modules/runners/components/runner-card/domain/runner-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RunnerCard } from '@/modules/runners/components/runner-card/runner-card';
import { updateCurrentSkills } from '@/modules/skills/store';
import { getSelectableSkillsForUma } from '@/modules/skills/utils';
import { SkillPickerModal } from '@/modules/skills/components/skill-picker/modal';
import { useHotkeys } from 'react-hotkeys-hook';

type RunnerEditorLayoutProps = {
  runnerName: string;
  runnerState: IRunnerState;
  onRunnerNameChange: (name: string) => void;
  onRunnerStateChange: (state: IRunnerState) => void;
  onSave: () => void;
  onCancel: () => void;
  isEditMode: boolean;
};

export const RunnerEditorLayout = (props: RunnerEditorLayoutProps) => {
  const {
    runnerName,
    runnerState,
    onRunnerNameChange,
    onRunnerStateChange,
    onSave,
    onCancel,
    isEditMode
  } = props;

  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const selectableSkills = useMemo(
    () => getSelectableSkillsForUma(runnerState.outfitId, true),
    [runnerState.outfitId]
  );

  const handleSetSkills = (skills: Array<string>) => {
    const reconciled = reconcileRunawayOnSkillsChange(skills, runnerState.strategy);
    onRunnerStateChange({
      ...runnerState,
      skills: reconciled.skills,
      strategy: reconciled.strategy
    });
    updateCurrentSkills(reconciled.skills);
    setSkillPickerOpen(false);
  };

  const handleRunnerChange = (newState: IRunnerState) => {
    onRunnerStateChange(newState);
    updateCurrentSkills(newState.skills);
  };

  useHotkeys(
    'f',
    (event) => {
      event.preventDefault();
      setSkillPickerOpen(true);
    },
    { enableOnFormTags: true, enabled: !skillPickerOpen },
    [skillPickerOpen]
  );

  return (
    <>
      <SkillPickerModal
        open={skillPickerOpen}
        umaId={runnerState.outfitId}
        options={selectableSkills}
        currentSkills={runnerState.skills}
        onSelect={handleSetSkills}
        onOpenChange={setSkillPickerOpen}
      />

      <div className="flex flex-col w-full mx-auto max-w-[900px] p-4">
        <div className="flex flex-col flex-1 bg-card rounded-md border">
          {/* Header with title and actions */}
          <div className="flex items-center justify-between p-4 border-b shrink-0">
            <div className="text-xl font-bold">
              {isEditMode ? 'Edit Runner' : 'Register Runner'}
            </div>
          </div>

          {/* Main content area */}
          <div className="flex flex-1">
            <div className="flex-1 overflow-y-auto p-4">
              <div className="flex flex-col gap-4">
                {/* Runner Name Input */}
                <div className="flex flex-col gap-2">
                  <Label htmlFor="runner-name">Runner Notes (required)</Label>
                  <Input
                    id="runner-name"
                    value={runnerName}
                    onChange={(e) => onRunnerNameChange(e.target.value)}
                    placeholder="Add a note here"
                    // eslint-disable-next-line jsx-a11y/no-autofocus -- autoFocus is intentional: primary action on page load
                    autoFocus
                    autoComplete="off"
                  />
                </div>

                {/* Runner Configuration */}
                <RunnerCard
                  value={runnerState}
                  runnerId="editor"
                  onChange={handleRunnerChange}
                  onOpenSkillPicker={() => setSkillPickerOpen(true)}
                  showShareButton={false}
                  showStrategyMood={false}
                />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 p-4 border-t">
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={onSave}>{isEditMode ? 'Update' : 'Create'}</Button>
          </div>
        </div>
      </div>
    </>
  );
};
