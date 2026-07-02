import { Activity, useCallback, useRef, useState } from 'react';
import {
  createNewCompareSeed,
  resetResults,
  setCompareSeed,
  useRaceStore
} from '@/modules/simulation/stores/compare.store';
import { Button } from '@/components/ui/button';
import { CompareLoadingOverlay } from '@/components/compare-loading-overlay';
import { useSimulationRunner } from '@/modules/simulation/hooks/compare/useSimulationRunner';
import { useSettingsStore } from '@/store/settings.store';
import { RaceSettingsPanel } from '@/modules/skill-planner/components/RaceSettingsPanel';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { parseSeed } from '@/utils/crypto';
import { HelpButton } from '@/components/ui/help-button';
import { umalatorSteps } from '@/modules/tutorial/steps/umalator-steps';
import { RaceTrack } from '@/modules/racetrack/racetrack';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  useCompareShareCardProps,
  CompareShareCard,
  copyCompareScreenshot,
  downloadSnapshot,
  ImportSnapshotDialog
} from '@/modules/simulation/share';
import { Camera, ChevronDown, Download, Share2, Upload } from 'lucide-react';
import { OverviewTab } from '@/modules/simulation/tabs/overview-tab';
import { SkillsTab } from '@/modules/simulation/tabs/skills-tab';

export default function CompareHomePage() {
  const { chartData, results, isSimulationRunning, simulationProgress, seed } = useRaceStore();
  const { courseId } = useSettingsStore();
  const { handleRunCompare, handleRunOnce } = useSimulationRunner();

  const [seedInput, setSeedInput] = useState<string>(() => {
    if (seed === null) return '';
    return seed.toString();
  });

  const [importSnapshotOpen, setImportSnapshotOpen] = useState(false);
  const compareShareRef = useRef<HTMLDivElement>(null);
  const compareShareProps = useCompareShareCardProps();

  const handleSeedInputBlur = useCallback(() => {
    const parsedSeed = parseSeed(seedInput);
    if (parsedSeed === null) return;
    setCompareSeed(parsedSeed);
  }, [seedInput]);

  const handleRunAllSamples = () => {
    const newSeed = createNewCompareSeed();
    setSeedInput(newSeed.toString());
    handleRunCompare(newSeed);
  };

  const handleRunOneSample = () => {
    const newSeed = createNewCompareSeed();
    setSeedInput(newSeed.toString());
    handleRunOnce(newSeed);
  };

  const handleReplayAllSamples = () => {
    if (seed === null) return;
    handleRunCompare(seed);
  };

  const handleReplayOneSample = () => {
    if (seed === null) return;
    handleRunOnce(seed);
  };

  return (
    <div className="relative flex flex-col flex-1 min-w-0 gap-4">
      <div data-tutorial="race-settings">
        <RaceSettingsPanel />
      </div>

      <div data-tutorial="simulation-controls" className="flex flex-wrap items-center gap-2">
        <Button
          data-tutorial="run-all-samples"
          onClick={handleRunAllSamples}
          disabled={isSimulationRunning}
          variant="default"
        >
          Run all samples
        </Button>
        <Button onClick={handleRunOneSample} disabled={isSimulationRunning} variant="outline">
          Run one sample
        </Button>

        <HelpButton tutorialId="umalator" steps={umalatorSteps} tooltipText="Show tutorial" />

        <div className="flex items-center gap-2">
          <Label htmlFor="seed-input" className="text-sm text-muted-foreground">
            Seed:
          </Label>
          <Input
            id="seed-input"
            type="number"
            value={seedInput}
            onChange={(e) => setSeedInput(e.target.value)}
            onBlur={handleSeedInputBlur}
            placeholder="Run to generate"
            className="w-40"
            disabled={isSimulationRunning}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={handleReplayAllSamples}
            disabled={isSimulationRunning || seedInput.trim() === ''}
          >
            Replay All
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleReplayOneSample}
            disabled={isSimulationRunning || seedInput.trim() === ''}
          >
            Replay One
          </Button>
        </div>

        <Button
          onClick={resetResults}
          disabled={isSimulationRunning || results.length === 0}
          variant="outline"
        >
          Clear
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" size="sm" disabled={isSimulationRunning}>
                Share settings
                <ChevronDown />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => downloadSnapshot()}>
              <Download className="size-4 mr-2" />
              Export simulation settings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setImportSnapshotOpen(true)}>
              <Upload className="size-4 mr-2" />
              Import simulation settings
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                disabled={isSimulationRunning || !compareShareProps}
              >
                <Share2 className="mr-1" />
                Share compare
                <ChevronDown />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={!compareShareProps}
              onClick={() => {
                if (compareShareRef.current) void copyCompareScreenshot(compareShareRef.current);
              }}
            >
              <Camera className="size-4 mr-2" />
              Copy compare screenshot
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <ImportSnapshotDialog open={importSnapshotOpen} onOpenChange={setImportSnapshotOpen} />
      </div>

      <div className="flex flex-col flex-1 gap-4">
        <Activity mode={!isSimulationRunning ? 'visible' : 'hidden'}>
          <div data-tutorial="race-visualization">
            <RaceTrack courseId={courseId} chartData={chartData} />
          </div>

          <div data-tutorial="results-tabs" className="space-y-4">
            <OverviewTab />

            <SkillsTab />
          </div>
        </Activity>

        <Activity mode={isSimulationRunning ? 'visible' : 'hidden'}>
          <CompareLoadingOverlay
            currentSamples={simulationProgress?.current}
            totalSamples={simulationProgress?.total}
          />
        </Activity>

        {compareShareProps && (
          <div style={{ position: 'absolute', left: -9999, top: 0 }}>
            <CompareShareCard ref={compareShareRef} {...compareShareProps} />
          </div>
        )}
      </div>
    </div>
  );
}
