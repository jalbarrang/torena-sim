import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ImageIcon, RotateCcw, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Progress, ProgressLabel, ProgressValue } from '@/components/ui/progress';
import { DropZone } from '@/modules/runners/components/ocr/components/drop-zone';
import type { PreparedImage } from '@/modules/runners/components/ocr/types';
import { LocalShopOcrEngine } from '../shop-ocr-engine';
import { createShopThumbnailPreview } from '../shop-ocr-preprocessing';
import {
  classifyShopMatches,
  getShopImportProgressValue,
  mergeShopOcrResults,
  processShopImageBatch,
  validateShopImageFiles,
  type ShopImportProgress,
  type ShopOcrProgress,
  type ShopOcrResult,
  type ShopOcrSkillMatch
} from '../shop-ocr';

const SHOP_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';
const EMPTY_RESULT: ShopOcrResult = { matches: [], unmatchedNames: [] };
const EMPTY_PROGRESS: ShopImportProgress = {
  activeImage: 0,
  activeImageProgress: 0,
  completedImages: 0,
  totalImages: 0
};

type ShopFileStatus = 'queued' | 'processing' | 'succeeded' | 'failed';

type ShopFileState = {
  id: string;
  file: File;
  status: ShopFileStatus;
  error?: string;
};

type ShopScreenshotImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingCandidateIds: Array<string>;
  obtainedSkillIds: Array<string>;
  selectableSkillIds: Array<string>;
  onApply: (matches: Array<ShopOcrSkillMatch>) => void;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Screenshot import failed.';
}

export function ShopScreenshotImportDialog(props: Readonly<ShopScreenshotImportDialogProps>) {
  const {
    open,
    onOpenChange,
    existingCandidateIds,
    obtainedSkillIds,
    selectableSkillIds,
    onApply
  } = props;

  const [engine] = useState(() => new LocalShopOcrEngine());
  const preparedImagesRef = useRef<Array<PreparedImage>>([]);
  const resultRef = useRef<ShopOcrResult>(EMPTY_RESULT);
  const abortRef = useRef<AbortController | null>(null);
  const processingRef = useRef(false);
  const sessionRef = useRef(0);
  const reviewHeadingRef = useRef<HTMLHeadingElement | null>(null);

  const [preparedImages, setPreparedImages] = useState<Array<PreparedImage>>([]);
  const [fileStates, setFileStates] = useState<Array<ShopFileState>>([]);
  const [result, setResult] = useState<ShopOcrResult>(EMPTY_RESULT);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<ShopImportProgress>(EMPTY_PROGRESS);
  const [processedCount, setProcessedCount] = useState(0);
  const [attentionMessages, setAttentionMessages] = useState<Array<string>>([]);
  const [processingLabel, setProcessingLabel] = useState('Preparing screenshot previews…');
  const [processingPhase, setProcessingPhase] = useState<ShopOcrProgress['phase']>('loading');

  const revokePreparedImages = useCallback(() => {
    for (const image of preparedImagesRef.current) {
      URL.revokeObjectURL(image.preview);
    }
    preparedImagesRef.current = [];
  }, []);

  const resetSession = useCallback(() => {
    sessionRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    processingRef.current = false;
    void engine.destroy();
    revokePreparedImages();
    resultRef.current = EMPTY_RESULT;
    setPreparedImages([]);
    setFileStates([]);
    setResult(EMPTY_RESULT);
    setIsProcessing(false);
    setProgress(EMPTY_PROGRESS);
    setProcessedCount(0);
    setAttentionMessages([]);
    setProcessingLabel('Preparing screenshot previews…');
    setProcessingPhase('loading');
  }, [engine, revokePreparedImages]);

  useEffect(() => {
    return () => {
      sessionRef.current += 1;
      abortRef.current?.abort();
      revokePreparedImages();
      void engine.destroy();
    };
  }, [engine, revokePreparedImages]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) resetSession();
    onOpenChange(nextOpen);
  };

  const updateFileState = (id: string, update: Partial<ShopFileState>) => {
    setFileStates((states) =>
      states.map((state) => (state.id === id ? { ...state, ...update } : state))
    );
  };

  const handleFiles = async (files: Array<File>) => {
    if (processingRef.current) return;

    const selection = validateShopImageFiles(
      files,
      preparedImagesRef.current.map((image) => image.blob)
    );
    if (selection.acceptedFiles.length === 0) {
      setAttentionMessages(
        selection.errors.length > 0 ? selection.errors : ['Choose PNG, JPEG, or WebP screenshots.']
      );
      return;
    }

    const session = sessionRef.current;
    processingRef.current = true;
    setIsProcessing(true);
    setProcessingPhase('loading');
    setProcessingLabel('Preparing bounded screenshot previews…');
    setAttentionMessages(selection.errors);
    setProgress({
      activeImage: 1,
      activeImageProgress: 0,
      completedImages: 0,
      totalImages: selection.acceptedFiles.length
    });

    const preparedBatch: Array<{ file: File; image: PreparedImage }> = [];
    const preparationErrors: Array<string> = [];
    for (const file of selection.acceptedFiles) {
      try {
        const preview = await createShopThumbnailPreview(file);
        if (session !== sessionRef.current) {
          URL.revokeObjectURL(preview);
          return;
        }
        preparedBatch.push({
          file,
          image: { blob: file, maskType: 'skills-only', preview, name: file.name }
        });
      } catch (error) {
        preparationErrors.push(`${file.name}: ${getErrorMessage(error)}`);
      }
    }

    if (session !== sessionRef.current) return;
    if (preparedBatch.length === 0) {
      setAttentionMessages([...selection.errors, ...preparationErrors]);
      processingRef.current = false;
      setIsProcessing(false);
      setProgress(EMPTY_PROGRESS);
      return;
    }

    const nextPreparedImages = preparedBatch.map(({ image }) => image);
    preparedImagesRef.current = [...preparedImagesRef.current, ...nextPreparedImages];
    setPreparedImages(preparedImagesRef.current);
    const batchStates = preparedBatch.map(({ file, image }) => ({
      id: image.preview,
      file,
      status: 'queued' as const
    }));
    setFileStates((states) => [...states, ...batchStates]);

    const controller = new AbortController();
    abortRef.current = controller;
    const batch = await processShopImageBatch(
      preparedBatch.map(({ file }) => file),
      {
        engine,
        signal: controller.signal,
        onProgress(imageIndex, nextProgress) {
          if (session !== sessionRef.current) return;
          const current = batchStates[imageIndex];
          if (current) updateFileState(current.id, { status: 'processing', error: undefined });
          setProcessingPhase(nextProgress.phase);
          setProcessingLabel(nextProgress.label);
          setProgress({
            activeImage: imageIndex + 1,
            activeImageProgress: nextProgress.progress,
            completedImages: imageIndex,
            totalImages: preparedBatch.length
          });
        },
        onResult(incoming, _file, imageIndex) {
          if (session !== sessionRef.current) return;
          const current = batchStates[imageIndex];
          if (current) updateFileState(current.id, { status: 'succeeded', error: undefined });
          const merged = mergeShopOcrResults(resultRef.current, incoming);
          resultRef.current = merged;
          setResult(merged);
          setProcessedCount((count) => count + 1);
        },
        onFailure(error, _file, imageIndex) {
          if (session !== sessionRef.current) return;
          const current = batchStates[imageIndex];
          if (current) {
            updateFileState(current.id, {
              status: 'failed',
              error: getErrorMessage(error)
            });
          }
        },
        onSettled(_file, imageIndex) {
          if (session !== sessionRef.current) return;
          if (imageIndex + 1 < preparedBatch.length) {
            setProcessingPhase('loading');
            setProcessingLabel('Preparing the next screenshot…');
          }
          setProgress({
            activeImage: Math.min(imageIndex + 2, preparedBatch.length),
            activeImageProgress: 0,
            completedImages: imageIndex + 1,
            totalImages: preparedBatch.length
          });
        }
      }
    );

    if (batch.aborted || session !== sessionRef.current) return;

    abortRef.current = null;
    processingRef.current = false;
    setIsProcessing(false);
    setAttentionMessages([...selection.errors, ...preparationErrors, ...batch.failedFiles]);
    if (batch.successfulCount > 0) {
      requestAnimationFrame(() => {
        if (session === sessionRef.current) reviewHeadingRef.current?.focus();
      });
    }
  };

  const removeFailedFiles = (ids: Set<string>) => {
    for (const image of preparedImagesRef.current) {
      if (ids.has(image.preview)) URL.revokeObjectURL(image.preview);
    }
    preparedImagesRef.current = preparedImagesRef.current.filter(
      (image) => !ids.has(image.preview)
    );
    setPreparedImages(preparedImagesRef.current);
    setFileStates((states) => states.filter((state) => !ids.has(state.id)));
  };

  const handleRetryFailed = () => {
    const failed = fileStates.filter((state) => state.status === 'failed');
    if (failed.length === 0) return;
    removeFailedFiles(new Set(failed.map((state) => state.id)));
    setAttentionMessages([]);
    void handleFiles(failed.map((state) => state.file));
  };

  const handleRemoveFailedFile = (state: ShopFileState) => {
    removeFailedFiles(new Set([state.id]));
    setAttentionMessages((messages) =>
      messages.filter((message) => !message.startsWith(`${state.file.name}:`))
    );
  };

  const handleRemoveMatch = (skillId: string) => {
    const nextResult = {
      ...resultRef.current,
      matches: resultRef.current.matches.filter((match) => match.id !== skillId)
    };
    resultRef.current = nextResult;
    setResult(nextResult);
  };

  const reviewedMatches = useMemo(
    () =>
      classifyShopMatches(result.matches, {
        existingCandidateIds,
        obtainedSkillIds,
        selectableSkillIds
      }),
    [existingCandidateIds, obtainedSkillIds, result.matches, selectableSkillIds]
  );
  const addableMatches = reviewedMatches.filter((match) => match.status === 'addable');
  const failedStates = fileStates.filter((state) => state.status === 'failed');
  const hasReview =
    processedCount > 0 || result.matches.length > 0 || result.unmatchedNames.length > 0;
  const progressValue = getShopImportProgressValue(progress);
  const currentStep = hasReview ? 2 : 1;
  const completionSummary = isProcessing
    ? `${processingLabel} Image ${progress.activeImage} of ${progress.totalImages}. ${progress.completedImages} completed.`
    : hasReview
      ? `Review ready. ${processedCount} screenshots processed, ${failedStates.length} failed, ${reviewedMatches.length} skills detected, and ${result.unmatchedNames.length} unmatched names.`
      : 'Ready for screenshots.';

  const handleApply = () => {
    onApply(addableMatches);
    handleOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="ph-no-capture ph-mask flex max-h-[90dvh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import shop screenshots</DialogTitle>
          <DialogDescription>
            Images are read in your browser and are never sent to an OCR service. OCR code and
            English data load from Torena Sim on first use; your browser may cache those assets.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          <ol
            className="flex items-center gap-2 text-xs text-muted-foreground"
            aria-label="Import steps"
          >
            {[
              { number: 1, label: 'Upload' },
              { number: 2, label: 'Review' }
            ].map((step, index) => (
              <li key={step.number} className="flex items-center gap-2">
                <span
                  aria-current={currentStep === step.number ? 'step' : undefined}
                  className={cn(
                    'rounded-lg border px-2 py-1',
                    currentStep >= step.number && 'border-primary bg-primary/10 text-foreground'
                  )}
                >
                  {step.number} {step.label}
                </span>
                {index === 0 && <span aria-hidden="true">→</span>}
              </li>
            ))}
          </ol>

          <div className={hasReview ? 'min-h-32' : 'min-h-48'}>
            <DropZone
              label={
                hasReview ? `${processedCount} screenshots processed` : 'Drop shop screenshots here'
              }
              description={
                hasReview
                  ? 'Drop more images; processing stays in this browser'
                  : 'Up to 8 images, 10 MB each, 40 MB total'
              }
              icon={<ImageIcon className="size-8" />}
              accept={SHOP_IMAGE_ACCEPT}
              disabled={isProcessing}
              thumbnails={preparedImages}
              onFiles={(files) => void handleFiles(files)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            PNG, JPEG, or WebP · maximum 5000 × 5000 pixels and 20 megapixels per image
          </p>

          {isProcessing && (
            <Progress
              value={processingPhase === 'loading' ? null : progressValue}
              aria-label="Shop screenshot processing progress"
            >
              <ProgressLabel>
                {processingLabel} Image {progress.activeImage} of {progress.totalImages}.
              </ProgressLabel>
              <ProgressValue>
                {() =>
                  processingPhase === 'loading' ? 'Preparing' : `${Math.round(progressValue)}%`
                }
              </ProgressValue>
            </Progress>
          )}

          <div className="sr-only" aria-live="polite" aria-atomic="true">
            {completionSummary}
          </div>

          {attentionMessages.length > 0 && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>Some images need attention</AlertTitle>
              <AlertDescription>
                <ul className="list-disc space-y-1 pl-4">
                  {attentionMessages.map((message, index) => (
                    <li key={`${index}-${message}`} className="break-words">
                      {message}
                    </li>
                  ))}
                </ul>
                {failedStates.length > 0 && !isProcessing && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={handleRetryFailed}
                  >
                    <RotateCcw /> Retry failed
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}

          {failedStates.length > 0 && (
            <section className="space-y-1.5" aria-labelledby="failed-shop-images-heading">
              <h3 id="failed-shop-images-heading" className="text-sm font-medium">
                Failed screenshots
              </h3>
              {failedStates.map((state) => (
                <div
                  key={state.id}
                  className="flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{state.file.name}</p>
                    <p className="break-words text-xs text-muted-foreground">{state.error}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="[@media(pointer:coarse)]:size-11"
                    aria-label={`Remove failed screenshot ${state.file.name}`}
                    onClick={() => handleRemoveFailedFile(state)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </section>
          )}

          {hasReview && (
            <section className="space-y-2" aria-labelledby="shop-ocr-review-heading">
              <div className="flex items-center justify-between gap-2">
                <h3
                  ref={reviewHeadingRef}
                  id="shop-ocr-review-heading"
                  tabIndex={-1}
                  className="text-sm font-medium outline-none"
                >
                  Detected skills
                </h3>
                <span className="text-xs text-muted-foreground">
                  {addableMatches.length} ready to add
                </span>
              </div>

              {reviewedMatches.length === 0 ? (
                <p className="rounded-lg border p-3 text-sm text-muted-foreground">
                  No skill names matched the planner data.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {reviewedMatches.map((match) => (
                    <div
                      key={match.id}
                      className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{match.name}</p>
                        {match.rawName !== match.name && (
                          <p className="truncate text-xs text-muted-foreground">
                            Read as “{match.rawName}”
                          </p>
                        )}
                        {match.statusLabel && (
                          <p className="text-xs text-muted-foreground">{match.statusLabel}</p>
                        )}
                      </div>
                      <Badge variant={match.status === 'addable' ? 'secondary' : 'outline'}>
                        Hint Lv {match.hintLevel}
                      </Badge>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="[@media(pointer:coarse)]:size-11"
                        aria-label={`Remove ${match.name}`}
                        onClick={() => handleRemoveMatch(match.id)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {result.unmatchedNames.length > 0 && (
                <div className="rounded-lg bg-muted/50 px-3 py-2">
                  <p className="text-xs font-medium">
                    Unmatched text ({result.unmatchedNames.length})
                  </p>
                  <p className="break-words text-xs text-muted-foreground">
                    {result.unmatchedNames.join(' · ')}
                  </p>
                </div>
              )}
            </section>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          {hasReview && (
            <Button
              type="button"
              onClick={handleApply}
              disabled={isProcessing || addableMatches.length === 0}
            >
              Add {addableMatches.length} {addableMatches.length === 1 ? 'skill' : 'skills'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
