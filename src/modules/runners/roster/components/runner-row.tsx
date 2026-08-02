import { memo } from 'react';
import { encodingToAptitude } from '@/modules/runners/share/converters';
import { GRADE_COLORS } from '../constants';
import { IDecodedRunner } from '../types';
import { Checkbox } from '@/components/ui/checkbox';
import { StatImage } from '@/modules/runners/components/StatInput';
import { Separator } from '@/components/ui/separator';

function AptGrade({ value }: Readonly<{ value: number }>) {
  const grade = encodingToAptitude(value);
  const color = GRADE_COLORS[value] ?? 'text-muted-foreground';
  return <span className={`font-semibold ${color}`}>{grade}</span>;
}

type IRunnerRowProps = Readonly<{
  runner: IDecodedRunner;
  index: number;
  isSelected: boolean;
  disabled?: boolean;
  onToggle: (index: number) => void;
}>;

export const RunnerRow = memo(function RunnerRow(props: Readonly<IRunnerRowProps>) {
  const { runner, index, isSelected, disabled = false, onToggle } = props;

  const runnerSource = runner.source;

  return (
    <button
      type="button"
      className={`flex w-full items-center gap-3 rounded-md border p-2 text-left transition-colors ${
        disabled
          ? 'cursor-default opacity-50'
          : isSelected
            ? 'cursor-pointer border-primary/40 bg-primary/5'
            : 'cursor-pointer opacity-50 hover:opacity-80'
      }`}
      disabled={disabled}
      onClick={() => onToggle(index)}
    >
      <Checkbox
        checked={isSelected}
        disabled={disabled}
        onCheckedChange={() => onToggle(index)}
        onClick={(e) => e.stopPropagation()}
      />

      <img src={runner.imageUrl} alt="" className="size-10 rounded shrink-0" />

      <div className="flex flex-col flex-1 min-w-0 gap-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold truncate">
            {runner.displayInfo?.name ?? 'Unknown Character'}
          </span>

          {runnerSource.rank_score != null && (
            <>
              <span className="text-xs text-muted-foreground">·</span>
              <span className="text-xs text-muted-foreground">{runnerSource.rank_score}</span>
            </>
          )}
        </div>

        {runner.displayInfo && (
          <div className="text-xs text-muted-foreground truncate">{runner.displayInfo.outfit}</div>
        )}

        <div className="flex flex-col md:flex-row items-center gap-2">
          <div className="flex items-center gap-2 text-xs">
            <div className="flex items-center gap-0.5">
              <StatImage value={runner.state.speed} className="size-3" />
              <span>{runner.state.speed}</span>
            </div>
            <div className="flex items-center gap-0.5">
              <StatImage value={runner.state.stamina} className="size-3" />
              <span>{runner.state.stamina}</span>
            </div>
            <div className="flex items-center gap-0.5">
              <StatImage value={runner.state.power} className="size-3" />
              <span>{runner.state.power}</span>
            </div>
            <div className="flex items-center gap-0.5">
              <StatImage value={runner.state.guts} className="size-3" />
              <span>{runner.state.guts}</span>
            </div>
            <div className="flex items-center gap-0.5">
              <StatImage value={runner.state.wisdom} className="size-3" />
              <span>{runner.state.wisdom}</span>
            </div>
          </div>

          <Separator orientation="vertical" className="h-4 hidden md:block" />

          <div className="flex items-center gap-1.5 text-[10px] shrink-0">
            <AptGrade value={runnerSource.proper_ground_turf} />
            <AptGrade value={runnerSource.proper_ground_dirt} />

            <span className="text-muted-foreground">·</span>

            <AptGrade value={runnerSource.proper_distance_short} />
            <AptGrade value={runnerSource.proper_distance_mile} />
            <AptGrade value={runnerSource.proper_distance_middle} />
            <AptGrade value={runnerSource.proper_distance_long} />

            <span className="text-muted-foreground">·</span>
            <AptGrade value={runnerSource.proper_running_style_nige} />
            <AptGrade value={runnerSource.proper_running_style_senko} />
            <AptGrade value={runnerSource.proper_running_style_sashi} />
            <AptGrade value={runnerSource.proper_running_style_oikomi} />
          </div>

          <span className="ml-auto text-xs text-muted-foreground">
            {disabled ? 'Already saved' : `${runner.state.skills.length} skills`}
          </span>
        </div>
      </div>
    </button>
  );
});
