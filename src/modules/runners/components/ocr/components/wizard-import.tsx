import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { AlertCircle, CheckCircle2, ScanLine, ShieldOff } from 'lucide-react';
import type { PreparedImage } from '@/modules/runners/components/ocr/types';
import type { ExtractedUmaData } from '@/modules/runners/ocr/types';
import { createPreparedImage, WIZARD_STEPS } from '@/modules/runners/components/ocr/definitions';
import {
  useOcrActions,
  useOcrProcessing,
  useOcrResults,
  useOcrTurnstileBroker,
  useOcrWizardState
} from '@/modules/runners/components/ocr/ocr-dialog.provider';

import { getIconById } from '@/modules/data/icons';
import { cn } from '@/lib/utils';
import { config } from '@/config';
import { TurnstileWidget, type TurnstileApiHandle } from '@/components/turnstile-widget';
import { OcrUmaSelector } from './uma-selector';
import { OcrStatsEditor } from './stats-editor';
import { OcrSkillsList } from './skill-list';
import { hasDetectedData } from '../helpers';

const EMPTY_THUMBNAILS: PreparedImage[] = [];

interface DropZoneProps {
  label: string;
  description: string;
  icon: React.ReactNode;
  accept?: string;
  disabled?: boolean;
  unavailable?: boolean;
  thumbnails?: Array<PreparedImage>;
  onFiles: (files: Array<File>) => void;
}

function DropZone({
  label,
  description,
  icon,
  accept = 'image/*',
  disabled = false,
  unavailable = false,
  thumbnails = EMPTY_THUMBNAILS,
  onFiles
}: Readonly<DropZoneProps>) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files ?? []).filter((file) =>
      file.type.startsWith('image/')
    );
    if (files.length > 0) {
      onFiles(files);
    }
  };

  const selectScreenshotFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter((file) => file.type.startsWith('image/'));
    if (files.length > 0) {
      onFiles(files);
    }
    e.target.value = '';
  };

  const handleOpenFilePicker = () => {
    if (!disabled) {
      inputRef.current?.click();
    }
  };

  if (unavailable) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-4 text-center">
        <ShieldOff className="size-8 text-muted-foreground" />
        <div className="space-y-1">
          <p className="text-sm font-medium">Screenshot import unavailable</p>
          <p className="text-xs text-muted-foreground max-w-[220px]">
            Screenshot import isn&apos;t configured for this build.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex-1 flex flex-col gap-3 rounded-lg border-2 border-dashed p-4 transition-colors cursor-pointer',
        disabled ? 'opacity-50 pointer-events-none' : 'hover:border-muted-foreground/50'
      )}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={handleOpenFilePicker}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleOpenFilePicker();
        }
      }}
    >
      <div className="flex flex-col items-center justify-center gap-2 text-center flex-1 py-4">
        <div className="text-muted-foreground">{icon}</div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground max-w-[180px]">{description}</p>
      </div>

      {thumbnails.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {thumbnails.map((img) => (
            <div key={img.preview} className="size-12 rounded border overflow-hidden shrink-0">
              <img
                src={img.preview}
                alt="Screenshot preview"
                className="w-full h-full object-cover"
              />
            </div>
          ))}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        className="hidden"
        onChange={selectScreenshotFiles}
        disabled={disabled}
      />
    </div>
  );
}

export function WizardImport() {
  const { workerUrl, turnstileSiteKey } = config.ocr;
  const ocrAvailable = Boolean(workerUrl && turnstileSiteKey);

  const broker = useOcrTurnstileBroker();
  const turnstileApiRef = useRef<TurnstileApiHandle | null>(null);
  const [tokenReady, setTokenReady] = useState(false);

  const results = useOcrResults();
  const { isProcessing, progress, error } = useOcrProcessing();
  const { step, preparedImages } = useOcrWizardState();
  const { processComposited, updateResults, removeSkill, reset, setStep, addPreparedImage } =
    useOcrActions();

  // Wire the widget's imperative reset into the broker so it can mint fresh
  // single-use tokens between the sequential per-screenshot worker calls.
  useEffect(() => {
    broker.attachReset(() => turnstileApiRef.current?.reset());
    return () => broker.attachReset(null);
  }, [broker]);

  const handleTurnstileVerify = (token: string) => {
    setTokenReady(true);
    broker.deliver(token);
  };

  const handleTurnstileInvalidate = () => {
    setTokenReady(false);
    broker.invalidate();
  };

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

          {ocrAvailable && turnstileSiteKey && (
            <div className="flex flex-col items-center gap-2">
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
      {step === 'summary' && (
        <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
          <div className="rounded-md border p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">Import Summary</h3>
              {hasDetectedData(results) && (
                <div className="text-green-600 flex items-center gap-1 text-sm">
                  <CheckCircle2 className="size-4" />
                  Ready to apply
                </div>
              )}
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Uma</p>
                {results?.outfitId ? (
                  <div className="flex items-center gap-2 mt-1">
                    <img
                      src={getIconById(results.outfitId)}
                      alt={results.umaName}
                      className="size-10 rounded"
                    />
                    <div>
                      <p className="font-medium">{results.outfitName}</p>
                      <p className="text-sm text-muted-foreground">{results.umaName}</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground mt-1">Not detected</p>
                )}
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Stats</p>
                <div className="grid grid-cols-5 gap-2 text-center text-sm">
                  {(['speed', 'stamina', 'power', 'guts', 'wisdom'] as const).map((stat) => (
                    <div key={stat} className="rounded border p-2">
                      <p className="text-[10px] text-muted-foreground uppercase">
                        {stat.slice(0, 3)}
                      </p>
                      <p className="font-mono">{results?.[stat] ?? '-'}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Skills</p>
                <p className="text-sm mt-1">{results?.skills?.length ?? 0} detected</p>
              </div>
            </div>
          </div>
        </div>
      )}

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
