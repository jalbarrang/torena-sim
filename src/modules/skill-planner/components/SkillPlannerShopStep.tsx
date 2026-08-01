import { useMemo, useState } from 'react';
import { ImageIcon, PlusIcon } from 'lucide-react';
import type { ShopOcrSkillMatch } from '../shop-ocr';
import { addCandidate, removeCandidate, useSkillPlannerStore } from '../skill-planner.store';
import { CandidateSkillList } from './CandidateSkillList';
import { ShopScreenshotImportDialog } from './ShopScreenshotImportDialog';
import { Button } from '@/components/ui/button';
import { getSelectableSkillsForUma } from '@/modules/skills/utils';
import { useHotkeys } from 'react-hotkeys-hook';
import { SkillPickerModal } from '@/modules/skills/components/skill-picker/modal';

export function SkillPlannerShopStep() {
  const { runner, candidates, obtainedSkillIds } = useSkillPlannerStore();
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [shopImportOpen, setShopImportOpen] = useState(false);
  const candidateIds = useMemo(() => Object.keys(candidates), [candidates]);

  const availableSkills = useMemo(() => {
    if (!runner.outfitId) {
      return [];
    }

    return getSelectableSkillsForUma(runner.outfitId, true);
  }, [runner.outfitId]);

  const handleApplyShopImport = (matches: Array<ShopOcrSkillMatch>) => {
    for (const match of matches) {
      addCandidate(match.id, match.hintLevel);
    }
  };

  const handleSelectSkills = (skills: Array<string>) => {
    const nextSkillIds = new Set(skills);
    const currentSkillIds = new Set(candidateIds);

    for (const skillId of candidateIds) {
      if (!nextSkillIds.has(skillId)) {
        removeCandidate(skillId);
      }
    }

    for (const skillId of nextSkillIds) {
      if (!currentSkillIds.has(skillId)) {
        addCandidate(skillId);
      }
    }

    setSkillPickerOpen(false);
  };

  useHotkeys(
    'f',
    (event) => {
      event.preventDefault();
      setSkillPickerOpen(true);
    },
    {
      enableOnFormTags: true,
      enabled: Boolean(runner.outfitId) && !skillPickerOpen && !shopImportOpen
    },
    [runner.outfitId, shopImportOpen, skillPickerOpen]
  );

  return (
    <>
      <SkillPickerModal
        open={skillPickerOpen}
        umaId={runner.outfitId}
        options={availableSkills}
        currentSkills={candidateIds}
        onSelect={handleSelectSkills}
        onOpenChange={setSkillPickerOpen}
      />

      <ShopScreenshotImportDialog
        open={shopImportOpen}
        onOpenChange={setShopImportOpen}
        existingCandidateIds={candidateIds}
        obtainedSkillIds={obtainedSkillIds}
        selectableSkillIds={availableSkills}
        onApply={handleApplyShopImport}
      />

      <div className="flex flex-col gap-4">
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-4 text-sm font-medium">Skills Shop</div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              size="lg"
              className="justify-start sm:flex-1"
              onClick={() => setShopImportOpen(true)}
              disabled={!runner.outfitId}
            >
              <ImageIcon className="mr-2" />
              Import shop screenshots
            </Button>

            <Button
              size="lg"
              variant="outline"
              className="justify-start sm:flex-1"
              onClick={() => setSkillPickerOpen(true)}
              disabled={!runner.outfitId}
            >
              <PlusIcon className="mr-2" />
              Add skills manually
            </Button>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <CandidateSkillList />
        </div>
      </div>
    </>
  );
}
