import { useMemo, useState } from 'react';
import { PlusIcon, UploadIcon } from 'lucide-react';
import { strategyNames } from '@/lib/uma-domain/runner/definitions';
import type { IRunnerState } from '@/modules/runners/components/runner-card/domain/runner-state';
import type { ExtractedUmaData } from '@/modules/runners/ocr/types';
import { OcrImportDialog } from '@/modules/runners/components/ocr-import-dialog';
import { RunnerCard } from './RunnerCard';
import {
  importRunnerBaseline,
  removeObtainedSkill,
  resetRunner,
  setHasFastLearner,
  setObtainedSkills,
  updateRunner,
  useSkillPlannerStore
} from '../skill-planner.store';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { getSelectableSkillsForUma, getUniqueSkillForByUmaId } from '@/modules/skills/utils';
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
import { RaceSettingsPanel } from './RaceSettingsPanel';
import { SkillPickerModal } from '@/modules/skills/components/skill-picker/modal';
import { useHotkeys } from 'react-hotkeys-hook';

function ObtainedSkillRow({ dismissable }: Readonly<{ dismissable: boolean }>) {
  return (
    <SkillItemRoot>
      <SkillItemRail />
      <SkillItemBody className="p-1 px-2">
        <SkillItemMain>
          <SkillItemIdentity />
          <SkillItemActions>
            <SkillItemDetailsActions dismissable={dismissable} className="shrink-0" />
          </SkillItemActions>
        </SkillItemMain>
      </SkillItemBody>
    </SkillItemRoot>
  );
}

export function SkillPlannerRunnerStep() {
  const { runner, obtainedSkillIds, hasFastLearner } = useSkillPlannerStore();
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [ocrImportOpen, setOcrImportOpen] = useState(false);
  const availableSkills = useMemo(() => {
    if (!runner.outfitId) {
      return [];
    }

    return getSelectableSkillsForUma(runner.outfitId, true);
  }, [runner.outfitId]);

  const uniqueSkillId = useMemo(() => {
    if (!runner.outfitId) {
      return '';
    }

    return getUniqueSkillForByUmaId(runner.outfitId);
  }, [runner.outfitId]);

  const handleRunnerChange = (partial: Partial<IRunnerState>) => {
    updateRunner(partial);
  };

  const handleOcrImportApply = (data: ExtractedUmaData) => {
    const nextOutfitId = data.outfitId ?? runner.outfitId;
    const importedSkillIds =
      data.skills.length > 0 ? data.skills.map((skill) => skill.id) : obtainedSkillIds;

    const runnerSnapshot: IRunnerState = {
      ...runner,
      outfitId: nextOutfitId,
      speed: data.speed ?? runner.speed,
      stamina: data.stamina ?? runner.stamina,
      power: data.power ?? runner.power,
      guts: data.guts ?? runner.guts,
      wisdom: data.wisdom ?? runner.wisdom,
      surfaceAptitude: data.surfaceAptitude ?? runner.surfaceAptitude,
      distanceAptitude: data.distanceAptitude ?? runner.distanceAptitude,
      strategyAptitude: data.strategyAptitude ?? runner.strategyAptitude,
      strategy:
        data.strategy && strategyNames.includes(data.strategy) ? data.strategy : runner.strategy,
      mood: runner.mood,
      skills: importedSkillIds,
      randomMobId: runner.randomMobId
    };

    importRunnerBaseline(runnerSnapshot);
  };

  const handleSelectSkills = (skillIds: Array<string>) => {
    setObtainedSkills(skillIds);
    setSkillPickerOpen(false);
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
        umaId={runner.outfitId}
        options={availableSkills}
        currentSkills={obtainedSkillIds}
        onSelect={handleSelectSkills}
        onOpenChange={setSkillPickerOpen}
      />

      <OcrImportDialog
        open={ocrImportOpen}
        onOpenChange={setOcrImportOpen}
        onApply={handleOcrImportApply}
      />

      <div className="flex flex-col gap-4">
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-4 flex items-center justify-between gap-2">
            <Button variant="outline" size="sm" onClick={() => setOcrImportOpen(true)}>
              <UploadIcon className="mr-2" />
              Import from Screenshot
            </Button>
          </div>

          <RunnerCard
            value={runner}
            onChange={handleRunnerChange}
            onReset={resetRunner}
            onImportVeteran={(runnerSnapshot) => importRunnerBaseline(runnerSnapshot)}
          />
        </div>

        <div className="flex flex-col gap-2 rounded-lg border bg-card p-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium">Obtained skills</div>

            <Button size="sm" onClick={() => setSkillPickerOpen(true)} disabled={!runner.outfitId}>
              <PlusIcon className="mr-2" />
              Add obtained skills (f)
            </Button>
          </div>

          {!runner.outfitId && (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              Select a runner first to edit obtained skills.
            </div>
          )}

          {runner.outfitId && obtainedSkillIds.length === 0 && (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              No obtained skills yet.
            </div>
          )}

          {runner.outfitId && obtainedSkillIds.length > 0 && (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {obtainedSkillIds.map((skillId) => (
                <SkillItem key={skillId} skillId={skillId} onRemove={removeObtainedSkill}>
                  <ObtainedSkillRow dismissable={skillId !== uniqueSkillId} />
                </SkillItem>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 rounded-lg border bg-card p-2">
          <div className="text-sm font-medium">Runner modifiers</div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="skill-planner-fast-learner"
              checked={hasFastLearner}
              onCheckedChange={(checked) => setHasFastLearner(checked === true)}
            />

            <Label htmlFor="skill-planner-fast-learner" className="font-normal">
              Fast Learner
            </Label>
          </div>
        </div>

        <RaceSettingsPanel open />
      </div>
    </>
  );
}
