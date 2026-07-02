import { useCallback, useState } from 'react';
import { Upload } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { parseSnapshotJson, importSnapshot } from './snapshot';
import type { SimulationSnapshot } from './types';
import type { IRunnerState } from '@/modules/runners/components/runner-card/types';
import { getUmaDisplayInfo } from '@/modules/runners/utils';
import { trackDescription } from '@/modules/racetrack/labels';

type ImportSnapshotDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function courseLabel(courseId: number): string {
  try {
    return trackDescription({ courseid: courseId });
  } catch {
    return `Course ID ${courseId}`;
  }
}

export function ImportSnapshotDialog({ open, onOpenChange }: ImportSnapshotDialogProps) {
  const [text, setText] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [preview, setPreview] = useState<SimulationSnapshot | null>(null);

  const applyParsed = useCallback((raw: string) => {
    setText(raw);
    const parsed = parseSnapshotJson(raw.trim());
    setPreview(parsed);
    if (raw.trim() && !parsed) {
      toast.error('Invalid simulation snapshot JSON');
    }
  }, []);

  const reset = useCallback(() => {
    setText('');
    setPreview(null);
  }, []);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      reset();
    }
    onOpenChange(next);
  };

  const handleFile = async (file: File) => {
    const text = await file.text();
    applyParsed(text);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleApply = () => {
    if (!preview) return;
    importSnapshot(preview);
    toast.success('Simulation settings loaded');
    handleOpenChange(false);
  };

  const handleOpenFilePicker = () => {
    document.getElementById('snapshot-file-input')?.click();
  };

  const runnerName = (runner: IRunnerState | undefined) =>
    runner
      ? runner.outfitId
        ? (getUmaDisplayInfo(runner.outfitId)?.name ?? runner.outfitId)
        : '(no uma)'
      : '';
  const uma1Name = preview ? runnerName(preview.runners[preview.compareA]) : '';
  const uma2Name = preview ? runnerName(preview.runners[preview.compareB]) : '';
  const fieldSize = preview ? preview.runners.length : 0;
  const compareModeLabel = preview
    ? preview.compareMode === 'contested'
      ? `Same race (${preview.fillWithMobs ? '+ mob pacers' : 'no mob padding'}${
          fieldSize > 2 ? `, ${fieldSize} runners` : ''
        })`
      : 'Vacuum (isolated)'
    : '';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import simulation settings</DialogTitle>
          <DialogDescription>
            Paste JSON or drop a file exported from Umalator. This replaces runners, race settings,
            seed, forced positions, and injected debuffs.
          </DialogDescription>
        </DialogHeader>

        <div
          className={`border-2 border-dashed rounded-lg p-6 flex flex-col items-center gap-2 cursor-pointer transition-colors ${
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
          <Upload className="size-8 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            Drop a .json file or click to browse
          </span>
          <input
            id="snapshot-file-input"
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = '';
            }}
          />
        </div>

        <textarea
          className="w-full min-h-[120px] p-3 rounded-md border bg-background font-mono text-xs resize-y focus:outline-none focus:ring-2 focus:ring-primary"
          placeholder="Or paste JSON here..."
          value={text}
          onChange={(e) => applyParsed(e.target.value)}
        />

        {preview && (
          <div className="rounded-md border p-3 space-y-2 text-sm">
            <div>
              <span className="text-muted-foreground">Course: </span>
              <span className="font-medium">{courseLabel(preview.courseId)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Samples: </span>
              <span className="font-medium">{preview.nsamples}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Seed: </span>
              <span className="font-medium">{preview.seed === null ? '(none)' : preview.seed}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Compare mode: </span>
              <span className="font-medium">{compareModeLabel}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Uma 1: </span>
              <span className="font-medium">{uma1Name}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Uma 2: </span>
              <span className="font-medium">{uma2Name}</span>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleApply} disabled={!preview}>
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
