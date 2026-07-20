import { useCallback, useMemo, useState } from 'react';
import { UploadIcon } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useUmasForSearch } from '@/modules/runners/utils';
import { useTraineeListStore } from '@/store/trainee-list.store';
import { importTraineeListSnapshot, parseTraineeListSnapshot } from '../share/snapshot';
import type { TraineeListSnapshot } from '../share/snapshot';

const FILE_INPUT_ID = 'trainee-list-file-input';

type ImportTraineeListDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type ParsedPreview = {
  snapshot: TraineeListSnapshot;
  skippedIds: Array<string>;
};

export function ImportTraineeListDialog(props: ImportTraineeListDialogProps) {
  const { open, onOpenChange } = props;

  const [text, setText] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [preview, setPreview] = useState<ParsedPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentCount = useTraineeListStore((state) => Object.keys(state.owned).length);

  // Accept upcoming outfits too, so imports survive server/data differences.
  const allUmas = useUmasForSearch(true);
  const knownOutfitIds = useMemo(() => new Set(allUmas.map((uma) => uma.id)), [allUmas]);

  const parseInput = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();

      if (!trimmed) {
        setPreview(null);
        setError(null);
        return;
      }

      const result = parseTraineeListSnapshot(trimmed, knownOutfitIds);

      if (result.ok) {
        setPreview({ snapshot: result.snapshot, skippedIds: result.skippedIds });
        setError(null);
      } else {
        setPreview(null);
        setError(result.error);
      }
    },
    [knownOutfitIds]
  );

  const applyParsed = useCallback(
    (raw: string) => {
      setText(raw);
      parseInput(raw);
    },
    [parseInput]
  );

  const reset = useCallback(() => {
    setText('');
    setPreview(null);
    setError(null);
  }, []);

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleFile = async (file: File) => {
    const fileText = await file.text();
    applyParsed(fileText);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  };

  const handleApply = () => {
    if (!preview) return;
    importTraineeListSnapshot(preview.snapshot);
    toast.success(`Imported ${Object.keys(preview.snapshot.trainees).length} trainees`);
    handleOpenChange(false);
  };

  const handleOpenFilePicker = () => {
    document.getElementById(FILE_INPUT_ID)?.click();
  };

  const importedCount = preview ? Object.keys(preview.snapshot.trainees).length : 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg! max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import trainee list</DialogTitle>
          <DialogDescription>
            Paste or drop a trainee list export (.json). Importing replaces your current list.
          </DialogDescription>
        </DialogHeader>

        <div
          className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 transition-colors ${
            isDragging ? 'border-primary bg-primary/10' : 'border-muted-foreground/30'
          }`}
          role="button"
          tabIndex={0}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setIsDragging(false);
          }}
          onDrop={handleDrop}
          onClick={handleOpenFilePicker}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleOpenFilePicker();
            }
          }}
        >
          <UploadIcon className="size-9 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            Drop a .json file or click to browse
          </span>
          <input
            id={FILE_INPUT_ID}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = '';
            }}
          />
        </div>

        <textarea
          className="min-h-[160px] w-full resize-y rounded-md border bg-background p-3 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-primary"
          placeholder="Or paste JSON here..."
          value={text}
          onChange={(e) => applyParsed(e.target.value)}
          aria-invalid={error ? true : undefined}
        />

        {error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error}
          </div>
        )}

        {preview && (
          <div className="space-y-2 rounded-md border p-3 text-sm">
            <div>
              <span className="text-muted-foreground">Trainees in export: </span>
              <span className="font-medium">{importedCount}</span>
            </div>
            {preview.skippedIds.length > 0 && (
              <div>
                <span className="text-muted-foreground">Skipped (unknown ids): </span>
                <span className="font-medium">{preview.skippedIds.length}</span>
              </div>
            )}
            {currentCount > 0 && (
              <div className="text-destructive">
                This replaces your current list of {currentCount}{' '}
                {currentCount === 1 ? 'trainee' : 'trainees'}.
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleApply} disabled={!preview}>
            {currentCount > 0 ? 'Replace list' : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
