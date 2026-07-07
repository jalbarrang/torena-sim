import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExtractedUmaData } from '@/modules/runners/ocr/types';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { config } from '@/config';
import { TurnstileWidget, type TurnstileApiHandle } from '@/components/turnstile-widget';
import { WizardImport } from '@/modules/runners/components/ocr/components/wizard-import';
import {
  OcrDialogProvider,
  useOcrActions,
  useOcrProcessing,
  useOcrResults,
  useOcrTurnstileBroker,
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

  const { workerUrl, turnstileSiteKey } = config.ocr;
  const ocrAvailable = Boolean(workerUrl && turnstileSiteKey);

  // Turnstile lives here — above the wizard steps — so a single widget instance
  // stays mounted for the whole dialog session. Navigating steps only toggles its
  // visibility (never unmounts it), so the minted token survives Back/Next and no
  // fresh challenge is wasted on remount.
  const broker = useOcrTurnstileBroker();
  const turnstileApiRef = useRef<TurnstileApiHandle | null>(null);
  const [tokenReady, setTokenReady] = useState(false);

  useEffect(() => {
    broker.attachReset(() => turnstileApiRef.current?.reset());
    return () => broker.attachReset(null);
  }, [broker]);

  // Stable identities so the memoized TurnstileWidget never re-renders on the
  // frequent dialog updates. broker is a stable singleton.
  const handleTurnstileVerify = useCallback(
    (token: string) => {
      setTokenReady(true);
      broker.deliver(token);
    },
    [broker]
  );

  const handleTurnstileInvalidate = useCallback(() => {
    setTokenReady(false);
    broker.invalidate();
  }, [broker]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      reset();
      // Widget state lives above the wizard now, so clear it explicitly on close;
      // the next session mounts a fresh widget and mints a new token.
      setTokenReady(false);
      broker.invalidate();
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
          <WizardImport tokenReady={tokenReady} />
        </div>

        {ocrAvailable && turnstileSiteKey && (
          <div
            className={cn(
              'flex flex-col items-center gap-2 pt-2',
              // Hide off the upload step AND during processing: consuming a token
              // resets the widget to pre-mint the next one, so keep that
              // token-rotation churn off-screen instead of flashing a re-challenge.
              (step !== 'align' || isProcessing) && 'hidden'
            )}
          >
            <TurnstileWidget
              siteKey={turnstileSiteKey}
              apiRef={turnstileApiRef}
              onVerify={handleTurnstileVerify}
              onExpire={handleTurnstileInvalidate}
              onError={handleTurnstileInvalidate}
            />
            {!tokenReady && (
              <p className="text-xs text-muted-foreground">Verifying before upload…</p>
            )}
          </div>
        )}

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
