import { useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { ChevronDown, Download, Link2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { SimulationControlBar } from '@/components/simulation-control-bar';
import { buildRaceSimSnapshot, downloadRaceSimSnapshot } from '@/modules/race-sim/share/snapshot';
import { encodeRaceSimShareCode } from '@/modules/race-sim/share/share-code';
import { ImportRaceSimDialog } from '@/modules/race-sim/share/import-race-sim-dialog';
import {
  clearResults,
  createNewRaceSeed,
  setNsamples,
  setRaceSeed,
  useRaceSimStore
} from '@/modules/simulation/stores/race-sim.store';

type RaceSimActionBarProps = {
  isRunning: boolean;
  onRun: (seed: number) => void;
  onCancel: () => void;
  onReplay: (seed: number) => void;
};

export function RaceSimActionBar({ isRunning, onRun, onCancel, onReplay }: RaceSimActionBarProps) {
  const { seed, nsamples, results } = useRaceSimStore(
    useShallow((state) => ({
      seed: state.seed,
      nsamples: state.nsamples,
      results: state.results
    }))
  );

  const [sampleState, setSampleState] = useState(() => ({
    nsamples,
    value: nsamples.toString()
  }));
  const [importOpen, setImportOpen] = useState(false);

  if (sampleState.nsamples !== nsamples) {
    setSampleState({ nsamples, value: nsamples.toString() });
  }

  const sampleInput = sampleState.value;
  const setSampleInput = (value: string) => {
    setSampleState({ nsamples, value });
  };

  const handleNsamplesBlur = () => {
    const parsed = Number(sampleInput);
    if (!Number.isFinite(parsed)) {
      setSampleInput(nsamples.toString());
      return;
    }

    setNsamples(parsed);
  };

  const clearDisabled = results === null;

  const handleCopyShareCode = async () => {
    if (!navigator.clipboard) {
      toast.error('Clipboard is not available in this browser');
      return;
    }
    try {
      const code = await encodeRaceSimShareCode(buildRaceSimSnapshot());
      await navigator.clipboard.writeText(code);
      toast.success('Share code copied to clipboard');
    } catch {
      toast.error('Failed to copy share code');
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SimulationControlBar
        isRunning={isRunning}
        seed={seed}
        onRun={onRun}
        onCancel={onCancel}
        onReplay={onReplay}
        onClear={clearResults}
        clearDisabled={clearDisabled || isRunning}
        createSeed={createNewRaceSeed}
        setSeed={setRaceSeed}
        runLabel="Run Race Simulation"
      />

      <div className="flex items-center gap-2">
        <Label htmlFor="race-sim-nsamples" className="text-sm text-muted-foreground">
          Samples:
        </Label>
        <Input
          id="race-sim-nsamples"
          type="number"
          min={1}
          max={10}
          value={sampleInput}
          onChange={(event) => setSampleInput(event.target.value)}
          onBlur={handleNsamplesBlur}
          className="w-20 text-sm"
          disabled={isRunning}
        />
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="sm" disabled={isRunning}>
              Share settings
              <ChevronDown />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => downloadRaceSimSnapshot()}>
            <Download className="size-4 mr-2" />
            Export race configuration
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void handleCopyShareCode()}>
            <Link2 className="size-4 mr-2" />
            Copy share code
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setImportOpen(true)}>
            <Upload className="size-4 mr-2" />
            Import race configuration
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ImportRaceSimDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
