import type { ExtractedUmaData } from '@/modules/runners/ocr/types';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { WizardImport } from '@/modules/runners/components/ocr/components/wizard-import';
import {
  OcrDialogProvider,
  useOcrActions,
  useOcrProcessing,
  useOcrResults,
  useOcrWizardState
} from '@/modules/runners/components/ocr/ocr-dialog.provider';
import { getNextWizardStep, getPreviousWizardStep } from './ocr/definitions';
import { hasDetectedData, toExtractedUmaData } from './ocr/helpers';

interface OcrImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (data: ExtractedUmaData) => void;
}

export function OcrImportDialog({ open, onOpenChange, onApply }: Readonly<OcrImportDialogProps>) {
  return (
    <OcrDialogProvider>
      <OcrImportContent open={open} onOpenChange={onOpenChange} onApply={onApply} />
    </OcrDialogProvider>
  );
}

type OcrImportContentProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (data: ExtractedUmaData) => void;
};

const OcrImportContent = ({ open, onOpenChange, onApply }: Readonly<OcrImportContentProps>) => {
  const { isProcessing } = useOcrProcessing();
  const results = useOcrResults();
  const { step } = useOcrWizardState();
  const { reset, setStep } = useOcrActions();

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      reset();
    }

    onOpenChange(nextOpen);
  };

  const handleClose = () => {
    if (open) {
      handleOpenChange(false);
    }
  };

  const handleWizardBack = () => {
    const previous = getPreviousWizardStep(step);
    if (previous) {
      setStep(previous);
    }
  };

  const handleWizardNext = () => {
    const next = getNextWizardStep(step);
    if (next) {
      setStep(next);
    }
  };

  const handleWizardApply = () => {
    if (results && hasDetectedData(results)) {
      onApply(toExtractedUmaData(results));
      handleClose();
    }
  };

  const showStepFooter = step !== 'align';
  const canApply = Boolean(results && hasDetectedData(results));

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex flex-col max-h-[90dvh] md:overflow-hidden md:min-w-230 min-h-[90dvh]">
        <DialogHeader>
          <DialogTitle>Import from Screenshots</DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <WizardImport />
        </div>

        {showStepFooter && (
          <DialogFooter className="sm:justify-between sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleWizardBack}
              disabled={isProcessing}
            >
              Back
            </Button>

            {step === 'summary' ? (
              <Button
                type="button"
                onClick={handleWizardApply}
                disabled={!canApply || isProcessing}
              >
                Apply
              </Button>
            ) : (
              <Button type="button" onClick={handleWizardNext} disabled={isProcessing}>
                Next
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
};
