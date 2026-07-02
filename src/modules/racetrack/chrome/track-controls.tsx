import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { toggleRaceTrackDisplay, useRaceTrackDisplay } from '@/store/settings.store';
import type { RaceTrackDisplaySettings } from '@/modules/racetrack/display-settings';
import { ChevronDownIcon } from 'lucide-react';
import React from 'react';
import { useComparePairNames } from '@/modules/runners/hooks/use-compare-names';

type DisplayOption = {
  settingKey: keyof RaceTrackDisplaySettings;
  label: string;
};

const UMA1_OPTIONS: DisplayOption[] = [
  { settingKey: 'showVelocityUma1', label: 'Velocity' },
  { settingKey: 'showHpUma1', label: 'HP' },
  { settingKey: 'showLanesUma1', label: 'Lanes' }
];

const UMA2_OPTIONS: DisplayOption[] = [
  { settingKey: 'showVelocityUma2', label: 'Velocity' },
  { settingKey: 'showHpUma2', label: 'HP' },
  { settingKey: 'showLanesUma2', label: 'Lanes' }
];

const RUNNER_GROUPS = [
  { key: 'uma1', options: UMA1_OPTIONS },
  { key: 'uma2', options: UMA2_OPTIONS }
] as const;

const RUNNER_OPTIONS: DisplayOption[] = [...UMA1_OPTIONS, ...UMA2_OPTIONS];

const THRESHOLD_OPTIONS: DisplayOption[] = [
  { settingKey: 'showThresholdHalfway', label: 'Halfway' },
  { settingKey: 'showThreshold777', label: '777m left' },
  { settingKey: 'showThreshold200', label: '200m left' }
];

const MARKER_OPTIONS: DisplayOption[] = [
  { settingKey: 'showSkillMarkers', label: 'Skill markers' },
  { settingKey: 'showDebuffMarkers', label: 'Debuff markers' },
  { settingKey: 'showRushedMarkers', label: 'Rushed markers' },
  { settingKey: 'showFullyChargedMarkers', label: 'Fully Charged markers' },
  { settingKey: 'showScenarioMarkers', label: 'Scenario markers' },
  { settingKey: 'showPosKeepLabels', label: 'Pos-keep labels' }
];

type DisplayDropdownProps = {
  title: string;
  options: DisplayOption[];
  display: ReturnType<typeof useRaceTrackDisplay>;
};

const DisplayDropdown = React.memo((props: DisplayDropdownProps) => {
  const { title, options, display } = props;

  const activeCount = options.filter((option) => display[option.settingKey]).length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs">
            {title}
            <span className="text-muted-foreground">
              ({activeCount}/{options.length})
            </span>
            <ChevronDownIcon className="opacity-60" />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="min-w-44">
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.settingKey}
            checked={display[option.settingKey]}
            onCheckedChange={() => toggleRaceTrackDisplay(option.settingKey)}
          >
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

type RunnersDropdownProps = {
  display: ReturnType<typeof useRaceTrackDisplay>;
};

const RunnersDropdown = React.memo((props: RunnersDropdownProps) => {
  const { display } = props;
  const names = useComparePairNames();

  const activeCount = RUNNER_OPTIONS.filter((option) => display[option.settingKey]).length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs">
            Runners
            <span className="text-muted-foreground">
              ({activeCount}/{RUNNER_OPTIONS.length})
            </span>
            <ChevronDownIcon className="opacity-60" />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="min-w-44">
        {RUNNER_GROUPS.map((group, groupIndex) => (
          <React.Fragment key={group.key}>
            {groupIndex > 0 && <DropdownMenuSeparator />}
            <DropdownMenuGroup>
              <DropdownMenuLabel className="max-w-44 truncate">
                {names[group.key]}
              </DropdownMenuLabel>
              {group.options.map((option) => (
                <DropdownMenuCheckboxItem
                  key={option.settingKey}
                  checked={display[option.settingKey]}
                  onCheckedChange={() => toggleRaceTrackDisplay(option.settingKey)}
                >
                  {option.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuGroup>
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

export const TrackControls = React.memo(() => {
  const display = useRaceTrackDisplay();

  return (
    <div className="flex flex-wrap items-center gap-3 px-2 py-1 text-xs text-foreground">
      <span className="pr-2 font-semibold tracking-wide text-foreground">Display</span>

      <Separator orientation="vertical" className="h-5" />

      <RunnersDropdown display={display} />
      <DisplayDropdown title="Thresholds" options={THRESHOLD_OPTIONS} display={display} />
      <DisplayDropdown title="Markers" options={MARKER_OPTIONS} display={display} />
    </div>
  );
});
