import { useCallback, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
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
import { setActivePlan } from '@/store/carat.store';
import { parseCaratPlanSnapshotJson, importCaratPlanSnapshot } from './snapshot';
import { decodeCaratPlanShareCode } from './share-code';
import type { CaratPlanSnapshot } from './types';

type ImportCaratPlanDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function totalEffectivePulls(snapshot: CaratPlanSnapshot): number {
  return snapshot.plannedBanners.reduce(
    (sum, banner) =>
      sum + Math.max(0, Math.floor(banner.pullResult?.pulls ?? banner.plannedPulls ?? 0)),
    0
  );
}

export function recordedBannerCount(snapshot: CaratPlanSnapshot): number {
  return snapshot.plannedBanners.filter((banner) => banner.pullResult !== undefined).length;
}

export function ImportCaratPlanDialog(props: ImportCaratPlanDialogProps) {
  const { open, onOpenChange } = props;

  const [text, setText] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [preview, setPreview] = useState<CaratPlanSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latestInputRef = useRef('');

  const parseInput = useCallback((raw: string) => {
    const trimmed = raw.trim();
    latestInputRef.current = trimmed;

    if (!trimmed) {
      setPreview(null);
      setError(null);
      return;
    }

    // Native snapshot JSON first, then an async share code.
    const parsed = parseCaratPlanSnapshotJson(trimmed);
    if (parsed) {
      setPreview(parsed);
      setError(null);
      return;
    }

    void decodeCaratPlanShareCode(trimmed).then((decoded) => {
      if (latestInputRef.current !== trimmed) return;
      setPreview(decoded);
      setError(
        decoded
          ? null
          : "Couldn't read this as a pull plan export or share code. Paste an exported .json or a share code."
      );
    });
  }, []);

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
    latestInputRef.current = '';
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
    const newPlanId = importCaratPlanSnapshot(preview);
    setActivePlan(newPlanId);
    toast.success(`Imported “${preview.name}” as a new plan`);
    handleOpenChange(false);
  };

  const handleOpenFilePicker = () => {
    document.getElementById('carat-plan-file-input')?.click();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg! max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import pull plan</DialogTitle>
          <DialogDescription>
            Paste or drop a pull plan export (.json) or a share code. It is added as a new plan and
            never overwrites your current plans.
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
          <Upload className="size-9 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            Drop a .json file or click to browse
          </span>
          <input
            id="carat-plan-file-input"
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
          placeholder="Or paste JSON / share code here..."
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
              <span className="text-muted-foreground">Name: </span>
              <span className="font-medium">{preview.name}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Server: </span>
              <span className="font-medium">
                {preview.settings.server === 'jp' ? 'JP' : 'Global'}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Banners: </span>
              <span className="font-medium">{preview.plannedBanners.length}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Total pulls: </span>
              <span className="font-medium">{totalEffectivePulls(preview)}</span>
            </div>
            {recordedBannerCount(preview) > 0 && (
              <div>
                <span className="text-muted-foreground">Recorded: </span>
                <span className="font-medium">{recordedBannerCount(preview)}</span>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleApply} disabled={!preview}>
            Import as new plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
