import { useMemo, useState } from 'react';
import { Link2, Link2Off, Save } from 'lucide-react';
import { RunnerCard } from './runner-card/runner-card';
import { SaveRunnerModal } from './save-runner-modal';
import {
  copyToRunner,
  linkRunner,
  resetAllRunners,
  showRunner,
  swapWithRunner,
  syncRunnerToLibrary,
  unlinkRunner,
  useCompareRoles,
  useRunner
} from '@/store/runners.store';
import { useSettingsStore } from '@/store/settings.store';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Panel, PanelContent, PanelHeader } from '@/components/ui/panel';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { coursesService } from '@/modules/data/services/CourseService';
import { useRunnerLibraryStore } from '@/store/runner-library.store';
import './style.css';

export const RunnersPanel = () => {
  const { runnerId, runner, updateRunner, resetRunner } = useRunner();
  const { compareA, compareB } = useCompareRoles();
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
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  const handleResetAllRunners = () => {
    resetAllRunners();
    setResetDialogOpen(false);
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
      <PanelHeader className="p-0 h-[48px]">
        <div className="flex h-full w-full items-center justify-between">
          <div className="grid grid-cols-2 h-full flex-1 items-center">
            <button
              type="button"
              className={cn(
                'px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer h-full',
                isEditingA
                  ? 'bg-[#2a77c5] text-white'
                  : 'bg-background text-muted-foreground hover:bg-muted'
              )}
              onClick={() => showRunner(compareA)}
            >
              Uma 1
            </button>

            <button
              type="button"
              className={cn(
                'px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer h-full',
                !isEditingA
                  ? 'bg-[#c52a2a] text-white'
                  : 'bg-background text-muted-foreground hover:bg-muted'
              )}
              onClick={() => showRunner(compareB)}
            >
              Uma 2
            </button>
          </div>

          <div className="flex items-center p-2">
            <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
              <AlertDialogTrigger
                render={
                  <Button
                    variant="destructive"
                    title="Reset all runners to default stats and skills"
                    size="sm"
                  />
                }
              >
                Reset all runners
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset all runners?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This clears the stats and skills for both Uma 1 and Uma 2 back to their
                    defaults. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={handleResetAllRunners}>
                    Reset all runners
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
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
    </Panel>
  );
};
