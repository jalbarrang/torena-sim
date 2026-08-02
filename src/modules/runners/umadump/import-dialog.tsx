import { useCallback, useMemo, useRef, useState } from 'react';
import { FileJson2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
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
    <div
      className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-5 transition-colors ${
        isDragging ? 'border-primary bg-primary/10' : 'border-muted-foreground/30'
      }`}
      role="button"
      tabIndex={0}
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
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          fileInputRef.current?.click();
        }
      }}
    >
      <Upload className="size-8 text-muted-foreground" />
      <span className="text-center text-sm text-muted-foreground">
        Drop trained_chara_data.json or click to browse
      </span>
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
    </div>
  );

  const sourceContent = preview ? (
    <>
      {dropZone}
      <div className="space-y-1 rounded-md bg-muted/50 p-3 text-sm">
        <div className="flex items-center gap-2 font-medium">
          <FileJson2 className="size-4" />
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
          <DialogTitle>Import from umadump</DialogTitle>
          <DialogDescription>
            Review an umadump link or choose trained_chara_data.json. The data stays in your browser
            and is never uploaded.
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
            <div className="flex flex-col gap-3">
              {dropZone}
              {isReading && (
                <div role="status" className="p-3 text-center text-sm text-muted-foreground">
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
