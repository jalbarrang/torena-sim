import { useCallback, useMemo } from 'react';
import { PlusIcon, XIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle
} from '@/components/ui/drawer';
import { skillsService } from '@/modules/data/services/SkillService';
import { AptitudesTable } from '@/modules/runners/components/runner-card/presentation/aptitudes-table';
import {
  StatsTable,
  type StatsKey
} from '@/modules/runners/components/runner-card/presentation/stats-table';
import { reconcileRunawayOnSkillsChange } from '@/modules/runners/components/runner-card/domain/runaway-policy';
import type { IRunnerState } from '@/modules/runners/components/runner-card/domain/runner-state';
import { UmaSelector } from '@/modules/runners/components/runner-selector';
import { getUmaDisplayInfo } from '@/modules/runners/utils';
import {
  SkillItemActions,
  SkillItemBody,
  SkillItemIdentity,
  SkillItemMain,
  SkillItemRail,
  SkillItemRoot
} from '@/modules/skills/components/skill-list/skill-item/primitives';
import { SkillItemDetailsActions } from '@/modules/skills/components/skill-list/skill-item/actions';
import { SkillItem } from '@/modules/skills/components/skill-list/skill-item/item';
import { openSkillPicker, updateCurrentSkills } from '@/modules/skills/store';
import { getSelectableSkillsForUma, getUniqueSkillForByUmaId } from '@/modules/skills/utils';
import { updateRunner, useRaceSimStore } from '@/modules/simulation/stores/race-sim.store';

type RunnerTileEditorProps = {
  open: boolean;
  runnerIndex: number | null;
  onOpenChange: (open: boolean) => void;
};

function RaceSimTileSkillRow({ dismissable }: Readonly<{ dismissable: boolean }>) {
  return (
    <SkillItemRoot>
      <SkillItemRail />
      <SkillItemBody className="p-1 px-2">
        <SkillItemMain>
          <SkillItemIdentity />
          <SkillItemActions>
            <SkillItemDetailsActions dismissable={dismissable} />
          </SkillItemActions>
        </SkillItemMain>
      </SkillItemBody>
    </SkillItemRoot>
  );
}

export function RunnerTileEditor(props: RunnerTileEditorProps) {
  const { open, runnerIndex, onOpenChange } = props;

  const runner = useRaceSimStore((state) => {
    if (runnerIndex === null || runnerIndex < 0 || runnerIndex >= state.runners.length) {
      return null;
    }
    return state.runners[runnerIndex];
  });

  const runnerDisplayName = useMemo(() => {
    if (!runner) {
      return 'Runner';
    }

    if (!runner.outfitId) {
      return runnerIndex === null ? 'Runner' : `Mob ${runnerIndex + 1}`;
    }

    const displayInfo = getUmaDisplayInfo(runner.outfitId);
    if (!displayInfo) {
      return 'Selected Runner';
    }

    return `${displayInfo.name} (${displayInfo.outfit})`;
  }, [runner, runnerIndex]);

  const applyRunnerPatch = useCallback(
    (partial: Partial<IRunnerState>) => {
      if (runnerIndex === null) {
        return;
      }

      updateRunner(runnerIndex, partial);
    },
    [runnerIndex]
  );

  const handleUpdateStat = useCallback(
    (stat: StatsKey) => (value: number) => {
      applyRunnerPatch({ [stat]: value });
    },
    [applyRunnerPatch]
  );

  const handleSetSkills = useCallback(
    (skills: Array<string>) => {
      if (!runner) {
        return;
      }

      const reconciled = reconcileRunawayOnSkillsChange(skills, runner.strategy);
      applyRunnerPatch({ skills: reconciled.skills, strategy: reconciled.strategy });
      updateCurrentSkills(reconciled.skills);
    },
    [applyRunnerPatch, runner]
  );

  const handleChangeRunner = useCallback(
    (outfitId: string) => {
      if (!runner) {
        return;
      }

      const keptSkills = runner.skills.filter((skillId) => {
        const baseSkillId = skillId.split('-', 1)[0] ?? skillId;
        const skillData = skillsService.getById(baseSkillId);
        return Boolean(skillData?.rarity && skillData.rarity < 3);
      });

      if (outfitId) {
        keptSkills.push(getUniqueSkillForByUmaId(outfitId));
      }

      applyRunnerPatch({
        outfitId,
        skills: keptSkills
      });
    },
    [applyRunnerPatch, runner]
  );

  const handleUpdateAptitudes = useCallback(
    (nextRunner: IRunnerState) => {
      applyRunnerPatch(nextRunner);
    },
    [applyRunnerPatch]
  );

  const handleOpenSkillPicker = useCallback(() => {
    if (!runner || runnerIndex === null) {
      return;
    }

    openSkillPicker({
      runnerId: `race-sim-runner-${runnerIndex}`,
      umaId: runner.outfitId,
      options: getSelectableSkillsForUma(runner.outfitId, true),
      currentSkills: runner.skills,
      onSelect: handleSetSkills
    });
  }, [handleSetSkills, runner, runnerIndex]);

  const handleRemoveSkill = useCallback(
    (skillId: string) => {
      if (!runner) {
        return;
      }

      handleSetSkills(runner.skills.filter((id) => id !== skillId));
    },
    [handleSetSkills, runner]
  );

  const uniqueSkillId = useMemo(() => {
    if (!runner?.outfitId) {
      return null;
    }

    return getUniqueSkillForByUmaId(runner.outfitId);
  }, [runner?.outfitId]);

  const gateLabel = runnerIndex === null ? '-' : runnerIndex + 1;

  return (
    <Drawer
      direction="right"
      open={open}
      onOpenChange={onOpenChange}
      // eslint-disable-next-line jsx-a11y/no-autofocus -- Vaul drawer autoFocus is intentional to move focus into the editor on open
      autoFocus
    >
      <DrawerContent className="px-2 w-full! md:w-[620px]! max-w-none!" data-vaul-no-drag>
        <DrawerHeader className="flex-row items-center justify-between">
          <div className="flex flex-col gap-1">
            <DrawerTitle>{`Edit Gate ${gateLabel}`}</DrawerTitle>
            <DrawerDescription>{runnerDisplayName}</DrawerDescription>
          </div>

          <DrawerClose tabIndex={-1} aria-label="Close runner editor">
            <XIcon className="size-4" />
          </DrawerClose>
        </DrawerHeader>

        {!runner && (
          <div className="p-4 text-sm text-muted-foreground">
            Select a runner tile to edit its setup.
          </div>
        )}

        {runner && (
          <div className="flex flex-col gap-4 px-2 pb-4 overflow-y-auto">
            <UmaSelector
              value={runner.outfitId}
              select={handleChangeRunner}
              onReset={() => handleChangeRunner('')}
              randomMobId={runner.randomMobId}
            />

            <StatsTable value={runner} onChange={handleUpdateStat} />

            <AptitudesTable value={runner} onChange={handleUpdateAptitudes} />

            <div className="flex items-center gap-2">
              <div className="bg-card py-1 px-2 border font-bold rounded-lg flex-1 text-center h-auto">
                Skills
              </div>

              <Button variant="default" onClick={handleOpenSkillPicker}>
                Add Skills
                <PlusIcon />
              </Button>
            </div>

            {runner.skills.length === 0 && (
              <div className="border rounded-lg p-3 text-sm text-muted-foreground">
                No skills selected for this runner.
              </div>
            )}

            {runner.skills.length > 0 && (
              <div className="grid grid-cols-1 gap-2">
                {runner.skills.map((skillId) => (
                  <SkillItem key={skillId} skillId={skillId} onRemove={handleRemoveSkill}>
                    <RaceSimTileSkillRow dismissable={skillId !== uniqueSkillId} />
                  </SkillItem>
                ))}
              </div>
            )}
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}
