import { useShallow } from 'zustand/shallow';
import { Activity, lazy, Suspense, useMemo } from 'react';
import { Clock, Eye, Heart, Shield, Zap } from 'lucide-react';
import { useRaceStore, setDisplaying } from '@/modules/simulation/stores/compare.store';
import { useWitVariance } from '@/store/settings.store';
import { simToDisplaySeconds } from '@/modules/race-sim/constants';
import { formatTime } from '@/utils/time';
import { cn } from '@/lib/utils';
import { ChartLoadingFallback } from '@/components/charts/chart-loading-fallback';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';

const LazyHistogram = lazy(() =>
  import('@/components/Histogram').then((module) => ({ default: module.Histogram }))
);

const formatLengths = (value: number) => {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}L`;
};

export const OverviewTab = () => {
  const {
    results,
    chartData,
    displaying,
    rushedStats,
    fullyChargedStats,
    staminaStats,
    leadCompetitionStats,
    duelingStats,
    firstUmaStats
  } = useRaceStore(
    useShallow((state) => ({
      results: state.results,
      chartData: state.chartData,
      displaying: state.displaying,
      rushedStats: state.rushedStats,
      fullyChargedStats: state.fullyChargedStats,
      staminaStats: state.staminaStats,
      leadCompetitionStats: state.leadCompetitionStats,
      duelingStats: state.duelingStats,
      firstUmaStats: state.firstUmaStats
    }))
  );
  const { allowRushedUma1, allowRushedUma2, allowConservePowerUma1, allowConservePowerUma2 } =
    useWitVariance();

  const summaryStats = useMemo(() => {
    if (results.length === 0) return null;

    const sorted = results.toSorted((a, b) => a - b);
    const n = sorted.length;
    const mean = sorted.reduce((a, b) => a + b, 0) / n;
    const mid = Math.floor(n / 2);
    const median = n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

    return {
      min: sorted[0],
      max: sorted[n - 1],
      mean,
      median,
      samples: n
    };
  }, [results]);

  if (!summaryStats || !chartData) {
    return (
      <Empty className="py-12">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Eye />
          </EmptyMedia>

          <EmptyTitle>No Overview Data</EmptyTitle>
          <EmptyDescription>
            Run simulations to see an overview of results, stats, and race mechanics.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const uma1Time = simToDisplaySeconds(chartData.time[0][chartData.time[0].length - 1]);
  const uma2Time = simToDisplaySeconds(chartData.time[1][chartData.time[1].length - 1]);
  const uma1TopSpeed = chartData.velocity[0].reduce((a, b) => Math.max(a, b), 0);
  const uma2TopSpeed = chartData.velocity[1].reduce((a, b) => Math.max(a, b), 0);

  const resolveColor = (value: number): string => {
    if (value < 0) return 'text-[#2a77c5]';
    if (value > 0) return 'text-[#c52a2a]';
    return 'text-muted-foreground';
  };

  const stats = [
    { label: 'MIN', value: summaryStats.min, color: resolveColor(summaryStats.min), key: 'minrun' },
    { label: 'MAX', value: summaryStats.max, color: resolveColor(summaryStats.max), key: 'maxrun' },
    {
      label: 'MEAN',
      value: summaryStats.mean,
      color: resolveColor(summaryStats.mean),
      key: 'meanrun'
    },
    {
      label: 'MEDIAN',
      value: summaryStats.median,
      color: resolveColor(summaryStats.median),
      key: 'medianrun'
    }
  ];

  const samples = { label: 'SAMPLES', value: summaryStats.samples, color: 'text-foreground' };

  return (
    <div className="flex flex-col gap-4">
      {/* Top summary card */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-4">
        {/* Stats row */}
        <div className="flex flex-wrap justify-center gap-4">
          {stats.map((stat) => (
            <div
              key={stat.key}
              role="button"
              tabIndex={0}
              className={cn(
                'flex flex-col items-center px-6 py-3 rounded-lg border border-border min-w-[100px] cursor-pointer',
                {
                  'ring-2 ring-primary border-primary': stat.key === displaying,
                  'hover:bg-accent hover:border-primary': displaying !== stat.key
                }
              )}
              onClick={() => setDisplaying(stat.key)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setDisplaying(stat.key);
                }
              }}
            >
              <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                {stat.label}
              </span>
              <span
                className={cn('text-xl font-bold', {
                  'text-primary': stat.key === displaying,
                  [stat.color]: stat.key !== displaying
                })}
              >
                {formatLengths(stat.value)}
              </span>
            </div>
          ))}

          <div className="flex flex-col items-center px-6 py-3 rounded-lg border border-border min-w-[100px]">
            <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
              SAMPLES
            </span>
            <span className="text-xl font-bold text-foreground">{samples.value}</span>
          </div>
        </div>

        {/* Histogram */}
        <div className="flex justify-center h-[240px]">
          <Suspense fallback={<ChartLoadingFallback className="w-full max-w-[600px]" />}>
            <LazyHistogram data={results} className="w-full max-w-[600px]" />
          </Suspense>
        </div>
      </div>

      {/* Uma cards side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {([0, 1] as const).map((umaIndex) => {
          const isUma1 = umaIndex === 0;
          const borderColor = isUma1 ? 'border-l-[#2a77c5]' : 'border-l-[#c52a2a]';
          const finishTime = isUma1 ? uma1Time : uma2Time;
          const topSpeed = isUma1 ? uma1TopSpeed : uma2TopSpeed;
          const rushed = isUma1 ? rushedStats?.uma1 : rushedStats?.uma2;
          const fullyCharged = isUma1 ? fullyChargedStats?.uma1 : fullyChargedStats?.uma2;
          const showRushed = isUma1 ? allowRushedUma1 : allowRushedUma2;
          const showFullyCharged = isUma1 ? allowConservePowerUma1 : allowConservePowerUma2;
          const spotStruggle = isUma1 ? leadCompetitionStats?.uma1 : leadCompetitionStats?.uma2;
          const dueling = isUma1 ? duelingStats?.uma1 : duelingStats?.uma2;
          const stamina = isUma1 ? staminaStats?.uma1 : staminaStats?.uma2;
          const firstUma = isUma1 ? firstUmaStats?.uma1 : firstUmaStats?.uma2;

          return (
            <div
              key={umaIndex}
              className={cn(
                'bg-card border border-border rounded-lg border-l-4 overflow-hidden',
                borderColor
              )}
            >
              {/* UMA header */}
              <div className="px-4 py-2 border-b border-border">
                <h3 className="text-sm font-bold text-foreground tracking-wide">
                  Uma {umaIndex + 1}
                </h3>
              </div>

              {/* Key stats row */}
              <div className="grid grid-cols-4 divide-x divide-border border-b border-border">
                <StatCell
                  icon={<Clock className="size-3.5" />}
                  value={formatTime(finishTime)}
                  label="FINISH"
                />
                <StatCell
                  icon={<Zap className="size-3.5" />}
                  value={topSpeed.toFixed(2)}
                  label="MAX M/S"
                />
                <StatCell
                  icon={<Heart className="size-3.5" />}
                  value={stamina ? `${stamina.fullSpurtRate.toFixed(0)}%` : '—'}
                  label="FULL SPURT"
                />
                <StatCell
                  icon={<Shield className="size-3.5" />}
                  value={stamina ? `${stamina.staminaSurvivalRate.toFixed(1)}%` : '—'}
                  label="HP SURVIVAL"
                />
              </div>

              {/* Detail rows */}
              <div className="px-4 py-3 space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Start Delay</span>
                  <span className="font-mono font-medium">
                    {chartData.startDelay[umaIndex].toFixed(3)}s
                  </span>
                </div>

                <Activity
                  mode={
                    (rushedStats && showRushed) ||
                    (fullyChargedStats && showFullyCharged) ||
                    leadCompetitionStats ||
                    duelingStats
                      ? 'visible'
                      : 'hidden'
                  }
                >
                  <div>
                    <h4 className="text-xs font-bold text-muted-foreground tracking-wider uppercase">
                      Race Mechanics
                    </h4>

                    <Activity mode={rushedStats && showRushed ? 'visible' : 'hidden'}>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground flex items-center gap-1.5">
                          <span className="text-base leading-none">💦</span> Rushed
                        </span>

                        <span className="font-mono font-medium">
                          {rushed && rushed.frequency > 0
                            ? `${rushed.frequency.toFixed(1)}% (${rushed.mean.toFixed(0)}m)`
                            : '0%'}
                        </span>
                      </div>
                    </Activity>

                    <Activity mode={fullyChargedStats && showFullyCharged ? 'visible' : 'hidden'}>
                      <div className="flex justify-between mt-1">
                        <span className="text-muted-foreground flex items-center gap-1.5">
                          <span className="text-base leading-none">⚡</span> Fully Charged
                        </span>

                        <span className="font-mono font-medium">
                          {fullyCharged && fullyCharged.frequency > 0
                            ? `${fullyCharged.frequency.toFixed(1)}% (+${fullyCharged.mean.toFixed(2)} m/s²)`
                            : '0%'}
                        </span>
                      </div>
                    </Activity>

                    <Activity mode={leadCompetitionStats ? 'visible' : 'hidden'}>
                      <div className="flex justify-between mt-1">
                        <span className="text-muted-foreground flex items-center gap-1.5">
                          <span className="text-base leading-none">🔥</span> Spot Struggle
                        </span>

                        <span className="font-mono font-medium">
                          {spotStruggle && spotStruggle.frequency > 0
                            ? `${spotStruggle.frequency.toFixed(1)}% (${spotStruggle.mean.toFixed(0)}m)`
                            : '0%'}
                        </span>
                      </div>
                    </Activity>

                    <Activity mode={duelingStats ? 'visible' : 'hidden'}>
                      <div className="flex justify-between mt-1">
                        <span className="text-muted-foreground flex items-center gap-1.5">
                          <span className="text-base leading-none">⚔</span> Dueling
                        </span>

                        <span className="font-mono font-medium">
                          {dueling && dueling.frequency > 0
                            ? `${dueling.frequency.toFixed(1)}% (${dueling.mean.toFixed(0)}m)`
                            : '0%'}
                        </span>
                      </div>
                    </Activity>
                  </div>
                </Activity>

                <Activity mode={firstUmaStats ? 'visible' : 'hidden'}>
                  <div className="space-y-1">
                    <h4 className="text-xs font-bold text-muted-foreground tracking-wider uppercase">
                      Miscellaneous
                    </h4>

                    <div className="flex justify-between">
                      <span className="text-muted-foreground">1st into Late Race</span>

                      <span className="font-mono font-medium">
                        {firstUma ? `${firstUma.firstPlaceRate.toFixed(1)}%` : '—'}
                      </span>
                    </div>
                  </div>
                </Activity>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

type StatCellProps = {
  icon: React.ReactNode;
  value: string;
  label: string;
};

const StatCell = (props: StatCellProps) => {
  const { icon, value, label } = props;

  return (
    <div className="flex flex-col items-center justify-center py-3 px-2 space-y-1">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-lg font-bold font-mono text-foreground">{value}</span>
      <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
        {label}
      </span>
    </div>
  );
};
