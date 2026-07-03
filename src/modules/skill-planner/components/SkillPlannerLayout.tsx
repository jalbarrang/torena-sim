import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftIcon, ArrowRightIcon } from 'lucide-react';
import {
  completeCurrentStep,
  reconcilePlannerPersistedState,
  setCurrentStep,
  startOver,
  useSkillPlannerStore
} from '../skill-planner.store';
import { SkillPlannerLanding } from './SkillPlannerLanding';
import { SkillPlannerStepper } from './SkillPlannerStepper';
import { SkillPlannerRunnerStep } from './SkillPlannerRunnerStep';
import { SkillPlannerShopStep } from './SkillPlannerShopStep';
import { SkillPlannerReviewStep } from './SkillPlannerReviewStep';
import type { WizardStep } from '../types';
import { Button } from '@/components/ui/button';
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

const nextStepByStep: Partial<Record<WizardStep, WizardStep>> = {
  runner: 'shop',
  shop: 'review'
};

const previousStepByStep: Partial<Record<WizardStep, WizardStep>> = {
  runner: 'home',
  shop: 'runner',
  review: 'shop'
};

export function SkillPlannerLayout() {
  const { hasActiveSession, currentStep, runner } = useSkillPlannerStore();
  const [startOverOpen, setStartOverOpen] = useState(false);

  // Runs only after DataBootGate has loaded the skill dataset (routes render
  // post-bootstrap), so persisted state from an earlier stale-cache session is
  // corrected here without requiring the user to re-click through the menus.
  useEffect(() => {
    reconcilePlannerPersistedState();
  }, []);

  const canContinue = useMemo(() => {
    if (currentStep === 'runner') {
      return runner.outfitId !== '';
    }

    if (currentStep === 'shop') {
      return true;
    }

    return false;
  }, [currentStep, runner.outfitId]);

  const handleBack = () => {
    const previousStep = previousStepByStep[currentStep];
    if (previousStep) {
      setCurrentStep(previousStep);
    }
  };

  const handleNext = () => {
    const nextStep = nextStepByStep[currentStep];
    if (!nextStep) {
      return;
    }

    completeCurrentStep();
    setCurrentStep(nextStep);
  };

  if (!hasActiveSession || currentStep === 'home') {
    return <SkillPlannerLanding />;
  }

  return (
    <>
      <AlertDialog open={startOverOpen} onOpenChange={setStartOverOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start over?</AlertDialogTitle>
            <AlertDialogDescription>
              This will reset the current Skill Planner session and return you to the start page.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>

            <AlertDialogAction
              onClick={() => {
                startOver();
                setStartOverOpen(false);
              }}
            >
              Start over
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="grid grid-cols-1 md:grid-cols-12">
        <div className="col-span-2"></div>
        <div className="col-span-8 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <SkillPlannerStepper currentStep={currentStep} onStepSelect={setCurrentStep} />

            {/* <Button variant="outline" size="sm" onClick={() => setStartOverOpen(true)}>
              <RotateCcwIcon className="mr-2" />
              Start over
            </Button> */}
          </div>

          <div className="min-h-0 flex-1">
            {currentStep === 'runner' && <SkillPlannerRunnerStep />}
            {currentStep === 'shop' && <SkillPlannerShopStep />}
            {currentStep === 'review' && (
              <SkillPlannerReviewStep
                onEditRunner={() => setCurrentStep('runner')}
                onEditShop={() => setCurrentStep('shop')}
              />
            )}
          </div>

          {currentStep !== 'review' && (
            <div className="flex items-center justify-between rounded-lg border bg-card px-4 py-3">
              <Button
                variant="outline"
                size="sm"
                onClick={handleBack}
                disabled={!previousStepByStep[currentStep]}
              >
                <ArrowLeftIcon className="mr-2" />
                Back
              </Button>

              <Button size="sm" onClick={handleNext} disabled={!canContinue}>
                Next
                <ArrowRightIcon className="ml-2" />
              </Button>
            </div>
          )}
        </div>

        <div className="col-span-2"></div>
      </div>
    </>
  );
}
