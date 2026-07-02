import { useCallback, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Panel,
  PanelContent,
  PanelDescription,
  PanelHeader,
  PanelTitle
} from '@/components/ui/panel';
import { skillsService } from '@/modules/data/services/SkillService';
import { DebuffGroup } from './DebuffGroup';
import { isInjectableExternalDebuffSkill } from '@/lib/uma-domain/skills/external-debuffs';
import { SkillPickerModal } from '@/modules/skills/components/skill-picker/modal';
import { addDebuff, clearAllDebuffs, useDebuffs } from '@/modules/simulation/stores/compare.store';
import { CompareRunnerId } from '../compare.types';
import { useComparePairNames } from '@/modules/runners/hooks/use-compare-names';

export function DebuffsPanel() {
  const { uma1, uma2 } = useDebuffs();
  const names = useComparePairNames();
  const [pickerRunnerId, setPickerRunnerId] = useState<CompareRunnerId | null>(null);
  const [pickerSelection, setPickerSelection] = useState<Array<string>>([]);

  const isPickerOpen = pickerRunnerId !== null;
  const hasDebuffs = uma1.length > 0 || uma2.length > 0;

  const debuffSkillOptions = useMemo(() => {
    const result: string[] = [];
    const skills = skillsService.getAll();

    for (const skill of skills) {
      if (isInjectableExternalDebuffSkill(skill)) {
        result.push(skill.id);
      }
    }

    return result;
  }, []);

  const handleOpenPicker = useCallback((runnerId: CompareRunnerId) => {
    setPickerRunnerId(runnerId);
    setPickerSelection([]);
  }, []);

  const handlePickerSelection = useCallback(
    (selectedSkills: Array<string>) => {
      setPickerSelection(selectedSkills);
      const selectedSkill = selectedSkills.at(-1);
      if (!selectedSkill || !pickerRunnerId) {
        return;
      }

      addDebuff(pickerRunnerId, skillsService.normalizeSkillId(selectedSkill), 0);
      setPickerSelection([]);
      setPickerRunnerId(null);
    },
    [pickerRunnerId]
  );

  const handlePickerOpenChange = useCallback((open: boolean) => {
    if (open) {
      return;
    }

    setPickerRunnerId(null);
    setPickerSelection([]);
  }, []);

  return (
    <>
      <Panel>
        <PanelHeader>
          <div className="flex items-start justify-between gap-2">
            <div>
              <PanelTitle>Debuffs</PanelTitle>
              <PanelDescription>
                Inject debuff skills at a fixed race distance. For each skill, enter the distance
                (m) where the debuff should proc.
              </PanelDescription>
            </div>
            <Button variant="outline" size="sm" onClick={clearAllDebuffs} disabled={!hasDebuffs}>
              Clear all
            </Button>
          </div>
        </PanelHeader>

        <PanelContent className="flex flex-col gap-3">
          <DebuffGroup runnerId="uma1" title={names.uma1} debuffs={uma1} onAdd={handleOpenPicker} />
          <DebuffGroup runnerId="uma2" title={names.uma2} debuffs={uma2} onAdd={handleOpenPicker} />
        </PanelContent>
      </Panel>

      <SkillPickerModal
        open={isPickerOpen}
        umaId={undefined}
        options={debuffSkillOptions}
        currentSkills={pickerSelection}
        onSelect={handlePickerSelection}
        onOpenChange={handlePickerOpenChange}
        allowDuplicateSkills
      />
    </>
  );
}
