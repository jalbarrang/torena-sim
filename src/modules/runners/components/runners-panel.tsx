import { useMemo, useRef, useState } from 'react';
import { ChevronDown, Link2, Link2Off, Save } from 'lucide-react';
import { RunnerCard } from './runner-card/runner-card';
import { SaveRunnerModal } from './save-runner-modal';
import { FieldManager } from './field-manager/field-manager';
import {
  COMPARE_A_COLOR,
  COMPARE_B_COLOR,
  RunnerAvatar
} from './field-manager/field-manager-content';
import {
  copyToRunner,
  linkRunner,
  resetAllRunners,
  swapWithRunner,
  syncRunnerToLibrary,
  unlinkRunner,
  useCompareRoles,
  useRunner,
  useRunners,
  MAX_RUNNERS,
  MIN_RUNNERS,
  type CompareRole,
  type FieldRunner
} from '@/store/runners.store';
import { getUmaDisplayInfo } from '@/modules/runners/utils';
import { useSettingsStore } from '@/store/settings.store';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Panel, PanelContent, PanelHeader } from '@/components/ui/panel';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { coursesService } from '@/modules/data/services/CourseService';
import { useRunnerLibraryStore } from '@/store/runner-library.store';
import './style.css';

const runnerDisplayName = (runner: FieldRunner | undefined): string => {
  if (!runner?.outfitId) return 'New runner';
  return getUmaDisplayInfo(runner.outfitId)?.name ?? 'New runner';
};

type VersusSlotProps = {
  compareRole: CompareRole;
  runner: FieldRunner | undefined;
  isEditing: boolean;
  onClick: () => void;
};

const VersusSlot = (props: VersusSlotProps) => {
  const { compareRole, runner, isEditing, onClick } = props;
  const isA = compareRole === 'uma1';
  const color = isA ? COMPARE_A_COLOR : COMPARE_B_COLOR;
  const letter = isA ? 'A' : 'B';
  const name = runnerDisplayName(runner);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Compare ${letter}: ${name}. Tap to change`}
      className={cn(
        'relative flex min-h-16 min-w-0 cursor-pointer items-center gap-2.5 bg-card px-3 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
        isEditing && 'bg-muted/40'
      )}
    >
      <span
        aria-hidden
        className={cn('absolute top-1.5 text-[10px] font-extrabold', isA ? 'left-2' : 'right-2')}
        style={{ color }}
      >
        {letter}
      </span>
      {runner && <RunnerAvatar runner={runner} compareRole={compareRole} />}
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{name}</span>
        <span className="block truncate text-xs text-muted-foreground">{runner?.strategy}</span>
      </span>
    </button>
  );
};

export const RunnersPanel = () => {
  const { runnerId, runner, updateRunner, resetRunner } = useRunner();
  const { compareA, compareB } = useCompareRoles();
  const runners = useRunners();
  const isEditingA = runnerId === compareA;
  const { courseId } = useSettingsStore();
  const {
    updateRunner: updateLibraryRunner,
    getRunner: getLibraryRunner,
    addRunner
  } = useRunnerLibraryStore();

  const course = useMemo(() => coursesService.getSimCourse(courseId), [courseId]);

  const isLinked = !!runner.linkedRunnerId;
  const linkedRunner = isLinked ? getLibraryRunner(runner.linkedRunnerId!) : null;

  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [pickRole, setPickRole] = useState<CompareRole | null>(null);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const fieldPillRef = useRef<HTMLButtonElement>(null);

  const runnerA = runners.find((r) => r.fieldId === compareA);
  const runnerB = runners.find((r) => r.fieldId === compareB);

  const openManager = (role: CompareRole | null) => {
    setPickRole(role);
    setManagerOpen(true);
  };

  const handleResetAll = () => {
    if (runners.length > MIN_RUNNERS) {
      setResetConfirmOpen(true);
      return;
    }
    resetAllRunners();
  };

  const handleCopyRunner = () => {
    if (isEditingA) {
      copyToRunner(compareA, compareB);
    } else {
      copyToRunner(compareB, compareA);
    }
  };

  const handleSwapRunners = () => {
    swapWithRunner(compareA, compareB);
  };

  const handleSyncToLibrary = () => {
    const linkedId = syncRunnerToLibrary(runnerId);
    if (linkedId) {
      updateLibraryRunner(linkedId, runner);
    }
  };

  const handleUnlink = () => {
    unlinkRunner(runnerId);
  };

  const handleSaveToVeterans = (name: string, shouldLink: boolean) => {
    const newRunnerId = addRunner({
      ...runner,
      notes: name
    });

    if (shouldLink) {
      linkRunner(runnerId, newRunnerId);
    }
  };

  return (
    <Panel>
      <PanelHeader className="p-0">
        <div data-tutorial="versus-slots" className="flex flex-col">
          <div className="grid grid-cols-2 gap-px border-b bg-border">
            <VersusSlot
              compareRole="uma1"
              runner={runnerA}
              isEditing={isEditingA}
              onClick={() => openManager('uma1')}
            />
            <VersusSlot
              compareRole="uma2"
              runner={runnerB}
              isEditing={!isEditingA && runnerId === compareB}
              onClick={() => openManager('uma2')}
            />
          </div>

          <div className="relative flex items-center justify-between px-2 py-1.5">
            <Button
              ref={fieldPillRef}
              variant="outline"
              size="sm"
              onClick={() => openManager(null)}
              aria-haspopup="dialog"
              className="rounded-full bg-popover text-xs font-semibold shadow-sm"
            >
              Field{' '}
              <span className="font-medium text-muted-foreground tabular-nums">
                {runners.length} / {MAX_RUNNERS}
              </span>
              <ChevronDown className="size-3 text-muted-foreground" />
            </Button>

            <Button
              onClick={handleResetAll}
              title="Reset the field back to two default runners"
              size="sm"
              variant="destructive"
            >
              Reset field
            </Button>
          </div>
        </div>
      </PanelHeader>

      <PanelContent className="p-0">
        {/* Library Link Indicator */}
        {isLinked && linkedRunner && (
          <div className="flex items-center justify-between gap-2 p-2 bg-muted/50 border-b">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="gap-1">
                <Link2 className="size-3" />
                Linked to: {linkedRunner.notes}
              </Badge>
            </div>
            <div className="flex gap-1">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button size="sm" variant="ghost" onClick={handleSyncToLibrary}>
                      <Save />
                    </Button>
                  }
                />
                <TooltipContent>Save changes to library</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button size="sm" variant="ghost" onClick={handleUnlink}>
                      <Link2Off />
                    </Button>
                  }
                />
                <TooltipContent>Unlink from library</TooltipContent>
              </Tooltip>
            </div>
          </div>
        )}

        {/* Save to Veterans Button */}
        {!isLinked && (
          <div className="flex items-center justify-end gap-2 p-2 bg-muted/50 border-b">
            <Button size="sm" variant="secondary" onClick={() => setSaveModalOpen(true)}>
              <Save className="mr-2" />
              Save to Veterans
            </Button>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <RunnerCard
            value={runner}
            courseDistance={course.distance}
            courseId={courseId}
            runnerId={runnerId}
            onChange={updateRunner}
            onReset={resetRunner}
            onCopy={handleCopyRunner}
            onSwap={handleSwapRunners}
            skillHotkey="k"
            showSkillSpCosts
          />
        </div>
      </PanelContent>

      <SaveRunnerModal
        open={saveModalOpen}
        onOpenChange={setSaveModalOpen}
        onSave={handleSaveToVeterans}
      />

      <FieldManager
        open={managerOpen}
        onOpenChange={setManagerOpen}
        pickRole={pickRole}
        anchor={fieldPillRef}
      />

      <AlertDialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Reset the field?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes all {runners.length} runners and starts over with two default runners.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                resetAllRunners();
                setResetConfirmOpen(false);
              }}
            >
              Reset field
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
};
