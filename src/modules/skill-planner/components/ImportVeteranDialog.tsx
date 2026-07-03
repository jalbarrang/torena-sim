import { useEffect, useMemo, useState } from 'react';
import { CheckIcon, SearchIcon } from 'lucide-react';
import type { IRunnerState } from '@/modules/runners/components/runner-card/types';
import { getUmaDisplayInfo, getUmaImageUrl } from '@/modules/runners/utils';
import { useRunnerLibraryStore, type ISavedRunner } from '@/store/runner-library.store';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type ImportVeteranDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportRunner: (runner: IRunnerState) => void;
};

function toRunnerStateSnapshot(runner: ISavedRunner): IRunnerState {
  return {
    outfitId: runner.outfitId,
    speed: runner.speed,
    stamina: runner.stamina,
    power: runner.power,
    guts: runner.guts,
    wisdom: runner.wisdom,
    strategy: runner.strategy,
    distanceAptitude: runner.distanceAptitude,
    surfaceAptitude: runner.surfaceAptitude,
    strategyAptitude: runner.strategyAptitude,
    mood: runner.mood,
    skills: runner.skills,
    randomMobId: runner.randomMobId
  };
}

function formatUpdatedAt(timestamp: number) {
  return new Date(timestamp).toLocaleString();
}

export function ImportVeteranDialog(props: Readonly<ImportVeteranDialogProps>) {
  const { open, onOpenChange, onImportRunner } = props;
  const runners = useRunnerLibraryStore((state) => state.runners);
  const [search, setSearch] = useState('');
  const [selectedRunnerId, setSelectedRunnerId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSearch('');
      setSelectedRunnerId(null);
    }
  }, [open]);

  const sortedRunners = useMemo(() => {
    return runners.toSorted((a, b) => b.updatedAt - a.updatedAt);
  }, [runners]);

  const searchIndex = useMemo(() => {
    return new Map(
      sortedRunners.map((runner) => {
        const info = runner.outfitId ? getUmaDisplayInfo(runner.outfitId) : null;
        const text = [info?.name, info?.outfit, runner.notes, runner.outfitId]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        return [runner.id, text];
      })
    );
  }, [sortedRunners]);

  const filteredRunners = useMemo(() => {
    const query = search.toLowerCase().trim();

    if (!query) {
      return sortedRunners;
    }

    return sortedRunners.filter((runner) => (searchIndex.get(runner.id) ?? '').includes(query));
  }, [search, searchIndex, sortedRunners]);

  const validSelectedRunnerId = filteredRunners.some((runner) => runner.id === selectedRunnerId)
    ? selectedRunnerId
    : null;

  const selectedRunner = useMemo(() => {
    return filteredRunners.find((runner) => runner.id === validSelectedRunnerId) ?? null;
  }, [filteredRunners, validSelectedRunnerId]);

  const handleImport = () => {
    if (!selectedRunner) {
      return;
    }

    onImportRunner(toRunnerStateSnapshot(selectedRunner));
    onOpenChange(false);
  };

  const hasRunners = sortedRunners.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import from Veterans</DialogTitle>
          <DialogDescription>
            Load a saved Veteran as your planner runner. Its skills count as already obtained (cost
            0), so the planner only optimizes the new skills you add.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by notes, Uma name, outfit, or outfit ID"
              className="pl-9"
            />
          </div>

          <div className="max-h-[420px] overflow-y-auto rounded-lg border">
            {!hasRunners && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No Veterans saved yet.
              </div>
            )}

            {hasRunners && filteredRunners.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No Veterans match your search.
              </div>
            )}

            {filteredRunners.length > 0 && (
              <div className="flex flex-col gap-2 p-2">
                {filteredRunners.map((runner) => {
                  const umaInfo = runner.outfitId ? getUmaDisplayInfo(runner.outfitId) : null;
                  const imageUrl = getUmaImageUrl(runner.outfitId, runner.randomMobId);
                  const isSelected = runner.id === validSelectedRunnerId;
                  const runnerLabel = umaInfo?.name || runner.notes || 'Saved runner';
                  const outfitLabel = umaInfo?.outfit || runner.outfitId || 'Custom runner';

                  return (
                    <button
                      key={runner.id}
                      type="button"
                      onClick={() => setSelectedRunnerId(runner.id)}
                      className={cn(
                        'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                        isSelected
                          ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                          : 'border-border hover:bg-accent/40'
                      )}
                    >
                      <img
                        src={imageUrl}
                        alt={runnerLabel}
                        className="size-16 rounded-md object-cover"
                      />

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-xs text-muted-foreground">
                              {outfitLabel}
                            </div>
                            <div className="truncate font-medium">{runnerLabel}</div>
                          </div>

                          {isSelected && <CheckIcon className="size-4 shrink-0 text-primary" />}
                        </div>

                        <div className="truncate text-sm text-muted-foreground">
                          {runner.notes || 'No notes'}
                        </div>

                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span>{runner.strategy}</span>
                          <span>{runner.skills.length} skills</span>
                          <span>
                            {runner.speed}/{runner.stamina}/{runner.power}/{runner.guts}/
                            {runner.wisdom}
                          </span>
                        </div>

                        <div className="mt-1 text-xs text-muted-foreground">
                          Updated {formatUpdatedAt(runner.updatedAt)}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={!selectedRunner}>
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
