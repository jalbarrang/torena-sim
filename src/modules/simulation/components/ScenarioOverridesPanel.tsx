import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Panel,
  PanelContent,
  PanelDescription,
  PanelHeader,
  PanelTitle
} from '@/components/ui/panel';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';
// import { ScenarioOverrideGroup } from './ScenarioOverrideGroup';
import {
  setForcedRushed,
  setForcedDueling,
  setForcedSpotStruggle,
  // addForcedRank,
  // removeForcedRank,
  clearAllScenarioOverrides,
  useScenarioOverrides,
  // useScenarioOverridesStore,
  hasAnyScenarioOverrides
} from '@/modules/simulation/stores/scenario-overrides.store';
import type { CompareRunnerId } from '../compare.types';
import { useComparePairNames } from '@/modules/runners/hooks/use-compare-names';
import type { ForcedRegion } from '../types';

// function updateRegionField(
//   runnerId: CompareRunnerId,
//   field: 'forcedRank',
//   index: number,
//   key: string,
//   value: number
// ) {
//   useScenarioOverridesStore.setState((prev) => ({
//     [runnerId]: {
//       ...prev[runnerId],
//       [field]: prev[runnerId][field].map((r: Record<string, number>, i: number) =>
//         i === index ? { ...r, [key]: value } : r
//       )
//     }
//   }));
// }

const RUNNER_IDS: Array<CompareRunnerId> = ['uma1', 'uma2'];

type SingleRegionOverrideProps = {
  runnerId: CompareRunnerId;
  label: string;
  region: ForcedRegion | null;
  defaultRegion: ForcedRegion;
  onSet: (runnerId: CompareRunnerId, region: ForcedRegion | null) => void;
};

function SingleRegionOverride(props: SingleRegionOverrideProps) {
  const { runnerId, label, region, defaultRegion, onSet } = props;
  const enabled = region !== null;

  return (
    <div className="flex flex-col gap-2 rounded-md border bg-background p-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </Label>
        <Checkbox
          checked={enabled}
          onCheckedChange={(checked) => {
            onSet(runnerId, checked ? defaultRegion : null);
          }}
        />
      </div>

      {enabled && (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={0}
            step={10}
            placeholder="Start"
            value={region.start}
            className="w-24"
            onChange={(e) =>
              onSet(runnerId, { ...region, start: Math.round(Number(e.currentTarget.value)) })
            }
          />
          <span className="text-xs text-muted-foreground">→</span>
          <Input
            type="number"
            min={0}
            step={10}
            placeholder="End"
            value={region.end}
            className="w-24"
            onChange={(e) =>
              onSet(runnerId, { ...region, end: Math.round(Number(e.currentTarget.value)) })
            }
          />
        </div>
      )}
    </div>
  );
}

export function ScenarioOverridesPanel() {
  const overrides = useScenarioOverrides();
  const names = useComparePairNames();
  const hasAny = hasAnyScenarioOverrides(overrides.uma1) || hasAnyScenarioOverrides(overrides.uma2);

  return (
    <Panel>
      <PanelHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <PanelTitle>Scenario Overrides</PanelTitle>
            <PanelDescription>
              Force specific race states in regions to test certain mechanics.
            </PanelDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={clearAllScenarioOverrides}
            disabled={!hasAny}
          >
            Clear all
          </Button>
        </div>
      </PanelHeader>

      <PanelContent className="flex flex-col gap-3">
        {/* Forced Rushed */}
        <Collapsible defaultOpen>
          <CollapsibleTrigger className="group flex w-full items-center gap-2 text-sm font-medium hover:text-foreground cursor-pointer">
            <ChevronDown className="size-3 transition-transform group-data-[state=closed]:-rotate-90" />
            Forced Rushed
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-2 pt-2">
            {RUNNER_IDS.map((id) => (
              <SingleRegionOverride
                key={id}
                runnerId={id}
                label={id === 'uma1' ? names.uma1 : names.uma2}
                region={overrides[id].forcedRushed}
                defaultRegion={{ start: 200, end: 600 }}
                onSet={setForcedRushed}
              />
            ))}
          </CollapsibleContent>
        </Collapsible>

        {/* Forced Dueling */}
        <Collapsible defaultOpen>
          <CollapsibleTrigger className="group flex w-full items-center gap-2 text-sm font-medium hover:text-foreground cursor-pointer">
            <ChevronDown className="size-3 transition-transform group-data-[state=closed]:-rotate-90" />
            Forced Dueling
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-2 pt-2">
            {RUNNER_IDS.map((id) => (
              <SingleRegionOverride
                key={id}
                runnerId={id}
                label={id === 'uma1' ? names.uma1 : names.uma2}
                region={overrides[id].forcedDueling}
                defaultRegion={{ start: 1000, end: 1400 }}
                onSet={setForcedDueling}
              />
            ))}
          </CollapsibleContent>
        </Collapsible>

        {/* Forced Spot Struggle */}
        <Collapsible defaultOpen>
          <CollapsibleTrigger className="group flex w-full items-center gap-2 text-sm font-medium hover:text-foreground cursor-pointer">
            <ChevronDown className="size-3 transition-transform group-data-[state=closed]:-rotate-90" />
            Forced Spot Struggle
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-2 pt-2">
            {RUNNER_IDS.map((id) => (
              <SingleRegionOverride
                key={id}
                runnerId={id}
                label={id === 'uma1' ? names.uma1 : names.uma2}
                region={overrides[id].forcedSpotStruggle}
                defaultRegion={{ start: 150, end: 800 }}
                onSet={setForcedSpotStruggle}
              />
            ))}
          </CollapsibleContent>
        </Collapsible>

        {/* Forced Rank */}
        {/* <Collapsible defaultOpen>
          <CollapsibleTrigger className="group flex w-full items-center gap-2 text-sm font-medium hover:text-foreground cursor-pointer">
            <ChevronDown className="size-3 transition-transform group-data-[state=closed]:-rotate-90" />
            Forced Position Rank
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-2 pt-2">
            {RUNNER_IDS.map((id) => (
              <ScenarioOverrideGroup
                key={id}
                title={label}
                regions={overrides[id].forcedRank}
                showRank
                onAdd={() => addForcedRank(id, { start: 0, end: 1200, rank: 4 })}
                onRemove={(i) => removeForcedRank(id, i)}
                onUpdateStart={(i, v) => updateRegionField(id, 'forcedRank', i, 'start', v)}
                onUpdateEnd={(i, v) => updateRegionField(id, 'forcedRank', i, 'end', v)}
                onUpdateRank={(i, v) => updateRegionField(id, 'forcedRank', i, 'rank', v)}
              />
            ))}
          </CollapsibleContent>
        </Collapsible> */}
      </PanelContent>
    </Panel>
  );
}
