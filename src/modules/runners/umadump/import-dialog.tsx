import { useCallback, useMemo, useRef, useState } from 'react';
import { ExternalLink, FileJson2, Link2, ShieldCheck, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { ImportRunnerPicker } from '../roster/components/import-runner-picker';
import { appendVeteransToLibrary } from '../roster/import-library';
import type { IDecodedRunner } from '../roster/types';
import { useRunnerLibraryStore } from '@/store/runner-library.store';
import {
  parseUmadumpTrainedCharaJson,
  veteranBuildFingerprint,
  type ParseUmadumpResult
} from './parser';

const UMADUMP_URL = 'https://github.com/Werseter/umadump';

export type UmadumpInitialImport = {
  id: string;
  sourceName: string;
  result: ParseUmadumpResult;
};

type UmadumpImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialImport?: UmadumpInitialImport;
};

type ParsedPreview = Extract<ParseUmadumpResult, { ok: true }>;

type GuideStepProps = {
  number: number;
  title: string;
  children: string;
};

function GuideStep(props: Readonly<GuideStepProps>) {
  const { number, title, children } = props;

  return (
    <li className="flex gap-3 py-2.5 first:pt-0 last:pb-0">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary font-mono text-xs font-medium text-secondary-foreground">
        {number}
      </span>
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{children}</p>
      </div>
    </li>
  );
}

function UmadumpGuide() {
  return (
    <section className="rounded-lg bg-muted/50 p-4" aria-labelledby="umadump-guide-title">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 id="umadump-guide-title" className="text-sm font-semibold">
            First time using umadump?
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            It exports your trained characters directly from the game.
          </p>
        </div>
        <a
          href={UMADUMP_URL}
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          Get umadump
          <ExternalLink />
        </a>
      </div>

      <ol className="divide-y divide-border/70">
        <GuideStep number={1} title="Run umadump with the game open">
          Download umadump, start Uma Musume, then run the exporter on your computer.
        </GuideStep>
        <GuideStep number={2} title="Export your Veterans">
          umadump creates trained_chara_data.json with stats, aptitudes, skills, and memos.
        </GuideStep>
        <GuideStep number={3} title="Open Torena or upload the file">
          Use umadump’s Torena link when available, or choose the JSON below. You review every
          Veteran before saving.
        </GuideStep>
      </ol>
    </section>
  );
}

export function UmadumpImportDialog(props: Readonly<UmadumpImportDialogProps>) {
  const { open, onOpenChange, initialImport } = props;
  const [preview, setPreview] = useState<ParsedPreview | null>(() =>
    initialImport?.result.ok ? initialImport.result : null
  );
  const [fileName, setFileName] = useState(initialImport?.sourceName ?? '');
  const [error, setError] = useState<string | null>(() =>
    initialImport && !initialImport.result.ok ? initialImport.result.error : null
  );
  const [isDragging, setIsDragging] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const readRequestRef = useRef(0);
  const savedRunners = useRunnerLibraryStore((state) => state.runners);

  const reset = useCallback(() => {
    readRequestRef.current++;
    setPreview(null);
    setFileName('');
    setError(null);
    setIsDragging(false);
    setIsReading(false);
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) reset();
      onOpenChange(next);
    },
    [onOpenChange, reset]
  );

  const handleFile = useCallback(async (file: File) => {
    const requestId = ++readRequestRef.current;
    setFileName(file.name);
    setError(null);
    setPreview(null);
    setIsReading(true);

    try {
      const raw = await file.text();
      if (requestId !== readRequestRef.current) return;

      const result = parseUmadumpTrainedCharaJson(raw);
      if (result.ok) setPreview(result);
      else setError(result.error);
    } catch {
      if (requestId === readRequestRef.current) {
        setError('The file could not be read. Choose trained_chara_data.json again.');
      }
    } finally {
      if (requestId === readRequestRef.current) setIsReading(false);
    }
  }, []);

  const existingFingerprints = useMemo(
    () => new Set(savedRunners.map(veteranBuildFingerprint)),
    [savedRunners]
  );

  const disabledIndices = useMemo(() => {
    if (!preview) return new Set<number>();
    return new Set(
      preview.runners.flatMap((runner, index) =>
        existingFingerprints.has(veteranBuildFingerprint(runner.state)) ? [index] : []
      )
    );
  }, [existingFingerprints, preview]);

  const initialSelectedIndices = useMemo(() => {
    if (!preview) return [];
    return preview.runners.flatMap((_, index) => (disabledIndices.has(index) ? [] : [index]));
  }, [disabledIndices, preview]);

  const handleImport = useCallback(
    (runners: IDecodedRunner[]) => {
      const count = appendVeteransToLibrary(
        runners.map((runner) => ({
          state: runner.state,
          notes: runner.importNotes ?? 'Imported from umadump'
        }))
      );
      toast.success(`Imported ${count} runner${count === 1 ? '' : 's'} to Veterans`);
      handleOpenChange(false);
    },
    [handleOpenChange]
  );

  const dropZone = (
    <>
      <button
        type="button"
        className={`flex w-full flex-col items-center gap-1.5 rounded-lg border-2 border-dashed p-5 text-center outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 ${
          isDragging
            ? 'border-primary bg-primary/10'
            : 'border-muted-foreground/30 hover:border-muted-foreground/50 hover:bg-muted/30'
        }`}
        aria-label="Choose umadump trained character JSON file"
        aria-busy={isReading}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setIsDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          const file = event.dataTransfer.files[0];
          if (file) void handleFile(file);
        }}
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload className="mb-1 size-7 text-muted-foreground" />
        <span className="text-sm font-medium">Choose trained_chara_data.json</span>
        <span className="text-xs text-muted-foreground">or drag and drop it here</span>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
          event.target.value = '';
        }}
      />
    </>
  );

  const sourceContent = preview ? (
    <>
      {!initialImport && dropZone}
      <div className="space-y-1 rounded-md bg-muted/50 p-3 text-sm">
        <div className="flex items-center gap-2 font-medium">
          {initialImport ? <Link2 className="size-4" /> : <FileJson2 className="size-4" />}
          <span className="truncate">{fileName}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          {preview.runners.length} trained character
          {preview.runners.length === 1 ? '' : 's'} found
        </div>
        {disabledIndices.size > 0 && (
          <div className="text-xs text-muted-foreground">
            {disabledIndices.size} already in Veterans and skipped
          </div>
        )}
        {(preview.skippedEntries > 0 || preview.skippedSkills > 0) && (
          <div className="text-xs text-destructive">
            Skipped {preview.skippedEntries} malformed runner
            {preview.skippedEntries === 1 ? '' : 's'} and {preview.skippedSkills} malformed skill
            {preview.skippedSkills === 1 ? '' : 's'}
          </div>
        )}
      </div>
    </>
  ) : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={`max-h-[calc(100dvh-2rem)] overflow-y-auto ${preview ? 'max-w-5xl!' : 'max-w-2xl!'}`}
      >
        <DialogHeader>
          <DialogTitle>
            {preview ? 'Review umadump Veterans' : 'Import Veterans with umadump'}
          </DialogTitle>
          <DialogDescription>
            {preview
              ? 'Choose the trained characters to add. Existing builds are detected automatically.'
              : 'Export your trained characters from Uma Musume, then bring them into Torena.'}
          </DialogDescription>
        </DialogHeader>

        {preview && sourceContent ? (
          <ImportRunnerPicker
            key={`${fileName}-${preview.runners.length}`}
            runners={preview.runners}
            sourceContent={sourceContent}
            initialSelectedIndices={initialSelectedIndices}
            disabledIndices={disabledIndices}
            onCancel={() => handleOpenChange(false)}
            onImport={handleImport}
          />
        ) : (
          <>
            <div className="flex flex-col gap-4">
              <UmadumpGuide />
              {dropZone}
              <div className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                <ShieldCheck className="mt-0.5 size-4 shrink-0" />
                <span>
                  Your export stays in this browser. Torena never uploads your game data or account
                  identifiers.
                </span>
              </div>
              {isReading && (
                <div role="status" className="p-2 text-center text-sm text-muted-foreground">
                  Reading trained characters…
                </div>
              )}
              {error && (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                >
                  {error}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
