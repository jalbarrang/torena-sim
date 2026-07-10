import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { skillsService } from '@/modules/data/services/SkillService';
import type { SkillComparisonRoundResult } from '@/modules/simulation/types';
import React from 'react';
import { ActivationDetails } from './activation-details';

/** `data-event` value on the expand control; must match delegated handler in BasinnChart. */
export const BASSIN_DATA_EVENT_TOGGLE_ACTIVATION_DETAILS = 'toggle-activation-details';

type SkillActivationDetailsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skillRow: SkillComparisonRoundResult | null;
  courseDistance: number;
  currentSeed: number | null;
  isGlobalSimulationRunning: boolean;
  skillLoading: boolean;
  onRunAdditionalSamples?: (skillId: string, additionalSamples: number) => void;
};

export const SkillActivationDetailsDialog = React.memo(function SkillActivationDetailsDialog(
  props: SkillActivationDetailsDialogProps
) {
  const {
    open,
    onOpenChange,
    skillRow,
    courseDistance,
    currentSeed,
    isGlobalSimulationRunning,
    skillLoading,
    onRunAdditionalSamples
  } = props;

  const skillId = skillRow?.id;
  const runData = skillRow?.runData;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="max-h-[90vh] max-w-[calc(100%-2rem)] gap-0 overflow-hidden p-0 sm:max-w-5xl"
      >
        {skillId && runData && (
          <>
            <DialogHeader className="border-b px-4 py-3">
              <DialogTitle className="text-base">{skillsService.getNameById(skillId)}</DialogTitle>
            </DialogHeader>
            <div className="max-h-[min(80vh,calc(90vh-4rem))] overflow-y-auto p-4">
              <ActivationDetails
                skillId={skillId}
                runData={runData}
                skillActivations={skillRow.skillActivations}
                results={skillRow.results}
                courseDistance={courseDistance}
                currentSeed={currentSeed}
                isGlobalSimulationRunning={isGlobalSimulationRunning}
                isSkillLoading={skillLoading}
                onRunAdditionalSamples={onRunAdditionalSamples}
              />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
});
