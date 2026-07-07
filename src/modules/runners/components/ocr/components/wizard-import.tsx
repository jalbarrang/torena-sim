import { AlertCircle, ScanLine } from 'lucide-react';
import type { ExtractedUmaData } from '@/modules/runners/ocr/types';
import { createPreparedImage, WIZARD_STEPS } from '@/modules/runners/components/ocr/definitions';
import {
  useOcrActions,
  useOcrProcessing,
  useOcrResults,
  useOcrWizardState
} from '@/modules/runners/components/ocr/ocr-dialog.provider';

import { cn } from '@/lib/utils';
import { config } from '@/config';
import { DropZone } from './drop-zone';
import { OcrUmaSelector } from './uma-selector';
import { OcrStatsEditor } from './stats-editor';
import { OcrAptitudesEditor } from './aptitudes-editor';
import { OcrSkillsList } from './skill-list';
import { WizardStepSummary } from './wizard-step-summary';

type WizardImportProps = {
  // Turnstile lives at the dialog level (mounted once for the whole session); this
  // reports whether a verification token is currently available to gate uploads.
  tokenReady: boolean;
};

export function WizardImport(props: Readonly<WizardImportProps>) {
  const { tokenReady } = props;
  const { workerUrl, turnstileSiteKey } = config.ocr;
  const ocrAvailable = Boolean(workerUrl && turnstileSiteKey);

  const results = useOcrResults();
  const { isProcessing, progress, error } = useOcrProcessing();
  const { step, preparedImages } = useOcrWizardState();
  const { processComposited, updateResults, removeSkill, reset, setStep, addPreparedImage } =
    useOcrActions();

  const handleFullDetailsFiles = async (files: Array<File>) => {
    if (files.length === 0) {
      return;
    }

    try {
      reset();

      const [fullDetailsFile, ...skillOnlyFiles] = files;
      addPreparedImage(createPreparedImage(fullDetailsFile, 'full-details-own'));
      let nextData: Partial<ExtractedUmaData> | undefined =
        (await processComposited(fullDetailsFile, 'full-details-own')) ?? undefined;

      for (const file of skillOnlyFiles) {
        addPreparedImage(createPreparedImage(file, 'skills-only'));
        nextData = (await processComposited(file, 'skills-only', nextData)) ?? undefined;
      }

      if (nextData) {
        setStep('review-identity');
      }
    } catch (err) {
      console.error('Failed to process OCR images', err);
    }
  };

  const activeStepIndex = WIZARD_STEPS.findIndex((entry) => entry.id === step);

  return (
    <div className="flex flex-col flex-1 gap-4 min-h-0">
      {/* Step indicator */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {WIZARD_STEPS.map((entry, index) => (
          <div key={entry.id} className="flex items-center gap-2">
            <div
              className={cn('px-2 py-1 rounded border', {
                'border-primary text-foreground bg-primary/10': index <= activeStepIndex,
                'border-muted': index > activeStepIndex
              })}
            >
              {entry.label}
            </div>

            {index < WIZARD_STEPS.length - 1 && <span>→</span>}
          </div>
        ))}
      </div>

      {/* Step: Upload */}
      {step === 'align' && (
        <div className="flex-1 min-h-0 flex flex-col gap-4 overflow-hidden">
          <DropZone
            label="Drop here"
            description="The screenshots of your runner, add more if she has a lot of skills."
            icon={<ScanLine className="size-8" />}
            disabled={isProcessing || (ocrAvailable && !tokenReady)}
            unavailable={!ocrAvailable}
            thumbnails={preparedImages}
            onFiles={(files) => void handleFullDetailsFiles(files)}
          />
        </div>
      )}

      {/* Step: Review Identity */}
      {step === 'review-identity' && (
        <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
          <OcrUmaSelector
            results={results}
            isProcessing={isProcessing}
            onUpdateResults={updateResults}
          />

          <OcrStatsEditor results={results} onUpdateResults={updateResults} />

          <OcrAptitudesEditor results={results} onUpdateResults={updateResults} />
        </div>
      )}

      {/* Step: Review Skills */}
      {step === 'review-skills' && (
        <div className="flex flex-col flex-1 min-h-0">
          <OcrSkillsList
            results={results}
            isProcessing={isProcessing}
            onRemoveSkill={removeSkill}
            onUpdateResults={updateResults}
          />
        </div>
      )}

      {/* Step: Summary */}
      {step === 'summary' && <WizardStepSummary results={results} />}

      {/* Progress */}
      {isProcessing && (
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Processing screenshot…</span>
            <span>{progress}%</span>
          </div>
          <div className="w-full bg-muted rounded-full h-2">
            <div
              className="bg-primary h-2 rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-md text-red-500 text-sm flex items-start gap-2">
          <AlertCircle className="size-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
