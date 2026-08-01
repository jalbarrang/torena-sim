import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { strategyNames } from '@/lib/uma-domain/runner/definitions';
import type { IRunnerState } from '@/modules/runners/components/runner-card/domain/runner-state';
import { getUmaDisplayInfo, getUmaImageUrl } from '@/modules/runners/utils';
import { getIconUrl } from '@/assets/icons';
import { getTeamStyle } from '@/modules/race-sim/team-colors';
import { rankLabel } from '@/modules/race-sim/rank-badge';
import { estimateRunnerRankScore } from '@/modules/race-sim/eval/rank-score';

type RunnerListItemProps = {
  index: number;
  runner: IRunnerState;
  isSelected: boolean;
  isFocused: boolean;
  onSelect: (index: number) => void;
  onToggleFocus: (index: number) => void;
};

const statIcons = [
  getIconUrl('status_00.png'),
  getIconUrl('status_01.png'),
  getIconUrl('status_02.png'),
  getIconUrl('status_03.png'),
  getIconUrl('status_04.png')
] as const;

function RankBadge({ runner }: Readonly<{ runner: IRunnerState }>) {
  const score = estimateRunnerRankScore(runner);
  const estimated = typeof runner.rankScore !== 'number';
  return (
    <span
      className="text-[10px] rounded bg-primary/15 px-1 py-px font-semibold text-primary"
      title={`${estimated ? 'Estimated rank' : 'Rank'} score ${score}`}
    >
      {rankLabel(score)}
      {estimated ? '*' : ''}
    </span>
  );
}

export function RunnerListItem(props: Readonly<RunnerListItemProps>) {
  const { index, runner, isSelected, isFocused, onSelect, onToggleFocus } = props;

  const imageUrl = useMemo(
    () => getUmaImageUrl(runner.outfitId, runner.randomMobId),
    [runner.outfitId, runner.randomMobId]
  );

  const umaInfo = useMemo(() => {
    if (!runner.outfitId) return null;
    return getUmaDisplayInfo(runner.outfitId);
  }, [runner.outfitId]);

  const stats = [
    { label: 'Spd', icon: statIcons[0], value: runner.speed },
    { label: 'Sta', icon: statIcons[1], value: runner.stamina },
    { label: 'Pow', icon: statIcons[2], value: runner.power },
    { label: 'Gut', icon: statIcons[3], value: runner.guts },
    { label: 'Wit', icon: statIcons[4], value: runner.wisdom }
  ];
  const focusCheckboxId = `runner-list-item-track-${index}`;

  return (
    <button
      type="button"
      onClick={() => onSelect(index)}
      className={cn(
        'group relative flex w-full items-start gap-3 rounded-lg p-2.5 text-left transition-all duration-150',
        'hover:bg-accent/60',
        isSelected ? 'bg-card shadow-sm ring-1 ring-primary/30' : 'bg-transparent'
      )}
    >
      {isSelected && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-8 rounded-r-full bg-primary" />
      )}

      <div className="relative shrink-0">
        <img
          src={imageUrl}
          alt={umaInfo?.name ?? `Runner ${index + 1}`}
          className={cn(
            'size-12 rounded-md object-cover ring-1 ring-border transition-all',
            isSelected && 'ring-primary/50'
          )}
        />
        <div
          className={cn(
            'absolute -top-1 -left-1 flex size-5 items-center justify-center rounded-full text-[10px] font-bold',
            'bg-muted text-muted-foreground ring-1 ring-border',
            isSelected && 'bg-primary text-primary-foreground ring-primary'
          )}
        >
          {index + 1}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-1.5 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <div className="min-w-0">
            {umaInfo ? (
              <>
                <div className="text-xs font-semibold truncate leading-tight">{umaInfo.name}</div>
                <div className="text-[10px] text-muted-foreground truncate leading-tight">
                  {umaInfo.outfit}
                </div>
              </>
            ) : (
              <div className="text-xs text-muted-foreground">Mob Runner</div>
            )}
          </div>

          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events -- label is bound to the checkbox via htmlFor; onClick only stops row-selection propagation */}
          <label
            htmlFor={focusCheckboxId}
            className="shrink-0 cursor-pointer"
            onClick={(e) => e.stopPropagation()}
          >
            <Checkbox
              id={focusCheckboxId}
              checked={isFocused}
              onCheckedChange={() => onToggleFocus(index)}
              className="size-3.5"
              aria-label={`Track runner ${index + 1}`}
            />
          </label>
        </div>

        <div className="flex items-center gap-0.5">
          {stats.map((stat) => (
            <div key={stat.label} className="flex items-center gap-px" title={stat.label}>
              <img src={stat.icon} alt="" className="size-3 opacity-70" />
              <span className="text-[10px] tabular-nums text-muted-foreground">{stat.value}</span>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {typeof runner.team === 'number' && (
            <span
              className={cn(
                'text-[10px] rounded px-1 py-px font-medium',
                getTeamStyle(runner.team).chipClass
              )}
            >
              {getTeamStyle(runner.team).label}
            </span>
          )}
          {runner.outfitId && <RankBadge runner={runner} />}
          <span className="text-[10px] rounded bg-secondary px-1 py-px font-medium text-secondary-foreground">
            {strategyNames.find((name) => name === runner.strategy) ?? 'Unknown'}
          </span>
          {runner.skills.length > 0 && (
            <span className="text-[10px] text-muted-foreground">
              {runner.skills.length} skill{runner.skills.length === 1 ? '' : 's'}
            </span>
          )}
          {typeof runner.gate === 'number' && (
            <span className="text-[10px] text-muted-foreground">Gate {runner.gate}</span>
          )}
        </div>
      </div>
    </button>
  );
}
