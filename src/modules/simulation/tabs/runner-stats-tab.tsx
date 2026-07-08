import { Activity, useMemo } from 'react';
import { Timer } from 'lucide-react';
import { useRaceStore } from '@/modules/simulation/stores/compare.store';
import { useWitVariance } from '@/store/settings.store';
import { simToDisplaySeconds } from '@/modules/race-sim/constants';
import { formatTime } from '@/utils/time';
import { Table, TableBody, TableCell, TableHead, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { useComparePairNames } from '@/modules/runners/hooks/use-compare-names';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';

export const RunnerStatsTab = () => {
  const { chartData, rushedStats, leadCompetitionStats, duelingStats, staminaStats } =
    useRaceStore();
  const names = useComparePairNames();
  const { allowRushedUma2 } = useWitVariance();

  const uma1Stats = useMemo(() => {
    if (!chartData) return null;

    return {
      topSpeed: chartData.velocity[0].reduce((a, b) => Math.max(a, b), 0),
      finishTime: simToDisplaySeconds(chartData.time[0][chartData.time[0].length - 1]),
      rushedStats: rushedStats?.uma1,
      leadCompetitionStats: leadCompetitionStats?.uma1,
      duelingStats: duelingStats?.uma1,
      staminaStats: staminaStats?.uma1
    };
  }, [chartData, rushedStats, leadCompetitionStats, duelingStats, staminaStats]);

  const uma2Stats = useMemo(() => {
    if (!chartData) return null;

    return {
      topSpeed: chartData.velocity[1].reduce((a, b) => Math.max(a, b), 0),
      finishTime: simToDisplaySeconds(chartData.time[1][chartData.time[1].length - 1]),
      rushedStats: rushedStats?.uma2,
      leadCompetitionStats: leadCompetitionStats?.uma2,
      duelingStats: duelingStats?.uma2,
      staminaStats: staminaStats?.uma2
    };
  }, [chartData, rushedStats, leadCompetitionStats, duelingStats, staminaStats]);

  if (!chartData || !uma1Stats || !uma2Stats) {
    return (
      <Empty className="py-12">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Timer />
          </EmptyMedia>
          <EmptyTitle>No Runner Statistics</EmptyTitle>
          <EmptyDescription>
            Run a simulation to compare finish times, top speeds, and performance metrics.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Side-by-side comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Uma 1 */}
        <div className="bg-background border-2 rounded-lg overflow-hidden">
          <div className="bg-[#2a77c5] dark:bg-blue-500 text-white text-center py-2 font-bold">
            <span className="block truncate px-2">{names.uma1}</span>
          </div>

          <Table>
            <TableBody>
              <TableRow>
                <TableHead className="font-medium">Time to finish</TableHead>
                <TableCell className="font-mono">{formatTime(uma1Stats.finishTime)}</TableCell>
              </TableRow>

              <TableRow>
                <TableHead className="font-medium">Start delay</TableHead>
                <TableCell className="font-mono">{chartData.startDelay[0].toFixed(4)} s</TableCell>
              </TableRow>

              <TableRow>
                <TableHead className="font-medium">Top speed</TableHead>
                <TableCell className="font-mono">{uma1Stats.topSpeed.toFixed(2)} m/s</TableCell>
              </TableRow>

              <Activity mode={rushedStats && allowRushedUma2 ? 'visible' : 'hidden'}>
                <TableRow>
                  <TableHead className="font-medium">Rushed frequency</TableHead>
                  <TableCell className="font-mono">
                    {uma1Stats.rushedStats && uma1Stats.rushedStats.frequency > 0
                      ? `${uma1Stats.rushedStats.frequency.toFixed(
                          1
                        )}% (${uma1Stats.rushedStats.mean.toFixed(1)}m)`
                      : '0%'}
                  </TableCell>
                </TableRow>
              </Activity>

              <Activity mode={leadCompetitionStats ? 'visible' : 'hidden'}>
                <TableRow>
                  <TableHead className="font-medium">Spot Struggle frequency</TableHead>
                  <TableCell className="font-mono">
                    {uma1Stats.leadCompetitionStats && uma1Stats.leadCompetitionStats.frequency > 0
                      ? `${uma1Stats.leadCompetitionStats.frequency.toFixed(1)}%`
                      : '0%'}
                  </TableCell>
                </TableRow>
              </Activity>

              <Activity mode={duelingStats ? 'visible' : 'hidden'}>
                <TableRow>
                  <TableHead className="font-medium">Dueling frequency</TableHead>
                  <TableCell className="font-mono">
                    {uma1Stats.duelingStats && uma1Stats.duelingStats.frequency > 0
                      ? `${uma1Stats.duelingStats.frequency.toFixed(1)}% (${uma1Stats.duelingStats.mean.toFixed(1)}m)`
                      : '0%'}
                  </TableCell>
                </TableRow>
              </Activity>

              <Activity mode={staminaStats ? 'visible' : 'hidden'}>
                <TableRow>
                  <TableHead className="font-medium">Spurt Rate</TableHead>
                  <TableCell className="font-mono">
                    {uma1Stats.staminaStats?.fullSpurtRate.toFixed(1)}%
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableHead className="font-medium">Survival Rate</TableHead>
                  <TableCell className="font-mono">
                    {uma1Stats.staminaStats?.staminaSurvivalRate.toFixed(1)}%
                  </TableCell>
                </TableRow>
              </Activity>
            </TableBody>
          </Table>
        </div>

        {/* Uma 2 */}
        <div className="bg-background border-2 rounded-lg overflow-hidden">
          <div className="bg-[#c52a2a] dark:bg-red-500 text-white text-center py-2 font-bold">
            <span className="block truncate px-2">{names.uma2}</span>
          </div>

          <Table>
            <TableBody>
              <TableRow>
                <TableHead className="font-medium">Time to finish</TableHead>
                <TableCell className="font-mono">{formatTime(uma2Stats.finishTime)}</TableCell>
              </TableRow>

              <TableRow>
                <TableHead className="font-medium">Start delay</TableHead>
                <TableCell className="font-mono">{chartData.startDelay[1].toFixed(4)} s</TableCell>
              </TableRow>

              <TableRow>
                <TableHead className="font-medium">Top speed</TableHead>
                <TableCell className="font-mono">{uma2Stats.topSpeed.toFixed(2)} m/s</TableCell>
              </TableRow>

              <Activity mode={rushedStats && allowRushedUma2 ? 'visible' : 'hidden'}>
                <TableRow>
                  <TableHead className="font-medium">Rushed frequency</TableHead>
                  <TableCell className="font-mono">
                    {uma2Stats.rushedStats && uma2Stats.rushedStats.frequency > 0
                      ? `${uma2Stats.rushedStats.frequency.toFixed(
                          1
                        )}% (${uma2Stats.rushedStats.mean.toFixed(1)}m)`
                      : '0%'}
                  </TableCell>
                </TableRow>
              </Activity>

              <Activity mode={leadCompetitionStats ? 'visible' : 'hidden'}>
                <TableRow>
                  <TableHead className="font-medium">Spot Struggle frequency</TableHead>
                  <TableCell className="font-mono">
                    {uma2Stats.leadCompetitionStats && uma2Stats.leadCompetitionStats.frequency > 0
                      ? `${uma2Stats.leadCompetitionStats.frequency.toFixed(1)}%`
                      : '0%'}
                  </TableCell>
                </TableRow>
              </Activity>

              <Activity mode={duelingStats ? 'visible' : 'hidden'}>
                <TableRow>
                  <TableHead className="font-medium">Dueling frequency</TableHead>
                  <TableCell className="font-mono">
                    {uma2Stats.duelingStats && uma2Stats.duelingStats.frequency > 0
                      ? `${uma2Stats.duelingStats.frequency.toFixed(1)}% (${uma2Stats.duelingStats.mean.toFixed(1)}m)`
                      : '0%'}
                  </TableCell>
                </TableRow>
              </Activity>

              <Activity mode={staminaStats ? 'visible' : 'hidden'}>
                <TableRow>
                  <TableHead className="font-medium">Spurt Rate</TableHead>
                  <TableCell className="font-mono">
                    {uma2Stats.staminaStats?.fullSpurtRate.toFixed(1)}%
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableHead className="font-medium">Survival Rate</TableHead>
                  <TableCell className="font-mono">
                    {uma2Stats.staminaStats?.staminaSurvivalRate.toFixed(1)}%
                  </TableCell>
                </TableRow>
              </Activity>
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Comparison Summary */}
      <div>
        <h4 className="text-sm font-semibold text-foreground mb-3">Quick Comparison</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div className="flex flex-col items-center p-3 bg-background border-2 rounded-lg">
            <span className="text-foreground mb-1">Time Difference</span>
            <span
              className={cn('text-lg font-bold', {
                'text-[#2a77c5] dark:text-blue-500': uma1Stats.finishTime < uma2Stats.finishTime,
                'text-[#c52a2a] dark:text-red-500': uma1Stats.finishTime > uma2Stats.finishTime
              })}
            >
              {Math.abs(uma1Stats.finishTime - uma2Stats.finishTime).toFixed(3)}s
            </span>
            <span className="text-xs text-foreground">
              <Activity mode={uma1Stats.finishTime < uma2Stats.finishTime ? 'visible' : 'hidden'}>
                {names.uma1} faster
              </Activity>

              <Activity mode={uma1Stats.finishTime > uma2Stats.finishTime ? 'visible' : 'hidden'}>
                {names.uma2} faster
              </Activity>

              <Activity mode={uma1Stats.finishTime === uma2Stats.finishTime ? 'visible' : 'hidden'}>
                Both finished at the same time
              </Activity>
            </span>
          </div>
          <div className="flex flex-col items-center p-3 bg-background border-2 rounded-lg">
            <span className="text-foreground mb-1">Speed Advantage</span>
            <span
              className={cn('text-lg font-bold', {
                'text-[#2a77c5] dark:text-blue-500': uma1Stats.topSpeed > uma2Stats.topSpeed,
                'text-[#c52a2a] dark:text-red-500': uma1Stats.topSpeed < uma2Stats.topSpeed
              })}
            >
              {Math.abs(uma1Stats.topSpeed - uma2Stats.topSpeed).toFixed(2)} m/s
            </span>
            <span className="text-xs text-foreground">
              {uma1Stats.topSpeed > uma2Stats.topSpeed
                ? `${names.uma1} higher top speed`
                : `${names.uma2} higher top speed`}
            </span>
          </div>
          <div className="flex flex-col items-center p-3 bg-background border-2 rounded-lg">
            <span className="text-foreground mb-1">Start Delay Diff</span>
            <span
              className={cn('text-lg font-bold', {
                'text-[#2a77c5] dark:text-blue-500':
                  chartData.startDelay[0] < chartData.startDelay[1],
                'text-[#c52a2a] dark:text-red-500':
                  chartData.startDelay[0] > chartData.startDelay[1]
              })}
            >
              {Math.abs(chartData.startDelay[0] - chartData.startDelay[1]).toFixed(4)}s
            </span>
            <span className="text-xs text-foreground">
              {chartData.startDelay[0] < chartData.startDelay[1]
                ? `${names.uma1} faster start`
                : `${names.uma2} faster start`}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
