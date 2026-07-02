import { Activity, useMemo } from 'react';
import { simToDisplaySeconds } from '@/modules/race-sim/constants';
import { setDisplaying, useRaceStore } from '@/modules/simulation/stores/compare.store';
import { cn } from '@/lib/utils';
import { formatTime } from '@/utils/time';
import { formatBashinWithRaw } from '@/utils/bashin';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { useComparePairNames } from '@/modules/runners/hooks/use-compare-names';

export const ResultButtonGroups = () => {
  const { displaying, results, chartData } = useRaceStore();

  const mid = useMemo(() => {
    return Math.floor(results.length / 2);
  }, [results]);

  const mean = useMemo(() => {
    return results.reduce((a, b) => a + b, 0) / results.length;
  }, [results]);

  const median = useMemo(() => {
    return results.length % 2 === 0 ? (results[mid - 1] + results[mid]) / 2 : results[mid];
  }, [results, mid]);

  const resultsSummary = useMemo(() => {
    return {
      minrun: {
        label: 'Minimum',
        value: results[0].toFixed(2)
      },
      maxrun: {
        label: 'Maximum',
        value: results[results.length - 1].toFixed(2)
      },
      meanrun: {
        label: 'Mean',
        value: mean.toFixed(2)
      },
      medianrun: {
        label: 'Median',
        value: median.toFixed(2)
      }
    };
  }, [results, mean, median]);

  return (
    <>
      {/* Summary Statistics Buttons */}
      <div className="flex flex-wrap gap-3 justify-center">
        {Object.entries(resultsSummary).map(([key, value]) => (
          <button
            key={key}
            onClick={() => setDisplaying(key)}
            className={cn(
              'flex flex-col items-center justify-center w-[120px] h-[100px] border border-border rounded-lg p-3 transition-all hover:bg-accent hover:border-primary',
              {
                'ring-2 ring-primary bg-primary border-primary text-primary-foreground hover:bg-primary/90':
                  displaying === key
              }
            )}
            type="button"
          >
            <span
              className={cn('text-xs text-foreground font-medium', {
                'text-primary-foreground!': displaying === key
              })}
            >
              {value.label}
            </span>
            <span
              className={cn('text-2xl font-bold text-foreground', {
                'text-primary-foreground!': displaying === key
              })}
            >
              {value.value}
            </span>
            <span
              className={cn('text-xs text-foreground', {
                'text-primary-foreground!': displaying === key
              })}
            >
              lengths
            </span>
          </button>
        ))}
      </div>

      {/* Standings Table */}
      <div className="bg-card p-4 rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">Place</TableHead>
              <TableHead>Runner</TableHead>
              <TableHead className="text-right">Finish</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displaying &&
              displaying in resultsSummary &&
              chartData &&
              resultsSummary[displaying as keyof typeof resultsSummary] &&
              (() => {
                const currentResult = resultsSummary[displaying as keyof typeof resultsSummary];
                const bashinDiff = Number.parseFloat(currentResult.value);
                const uma1Faster = bashinDiff < 0;

                return (
                  <>
                    <TableRow>
                      <TableCell className="font-bold">1st</TableCell>
                      <TableCell
                        className={cn('font-bold font-mono', {
                          'text-[#2a77c5] dark:text-blue-500': uma1Faster,
                          'text-[#c52a2a] dark:text-red-500': !uma1Faster
                        })}
                      >
                        {uma1Faster ? 'Umamusume 1' : 'Umamusume 2'}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {uma1Faster
                          ? formatTime(
                              simToDisplaySeconds(chartData.time[0][chartData.time[0].length - 1])
                            )
                          : formatTime(
                              simToDisplaySeconds(chartData.time[1][chartData.time[1].length - 1])
                            )}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-bold">2nd</TableCell>
                      <TableCell
                        className={cn('font-mono', {
                          'text-[#c52a2a] dark:text-red-500': uma1Faster,
                          'text-[#2a77c5] dark:text-blue-500': !uma1Faster
                        })}
                      >
                        {uma1Faster ? 'Umamusume 2' : 'Umamusume 1'}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatBashinWithRaw(bashinDiff)}
                      </TableCell>
                    </TableRow>
                  </>
                );
              })()}
          </TableBody>
        </Table>
      </div>
    </>
  );
};

export const SummaryTab = () => {
  const { firstUmaStats, staminaStats } = useRaceStore();
  const names = useComparePairNames();

  return (
    <div className="flex flex-col gap-4">
      {/* Quick Stats Summary */}
      <Activity mode={firstUmaStats || staminaStats ? 'visible' : 'hidden'}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-mono">Runner</TableHead>
              <Activity mode={firstUmaStats ? 'visible' : 'hidden'}>
                <TableHead className="font-mono">Final Leg 1st Place</TableHead>
              </Activity>
              <Activity mode={staminaStats ? 'visible' : 'hidden'}>
                <TableHead className="font-mono">Spurt Rate</TableHead>
                <TableHead className="font-mono">Survival Rate</TableHead>
              </Activity>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="max-w-40 truncate font-mono text-[#2a77c5] dark:text-blue-500 font-bold">
                {names.uma1}
              </TableCell>
              <Activity mode={firstUmaStats ? 'visible' : 'hidden'}>
                <TableCell className="font-mono">
                  {firstUmaStats?.uma1.firstPlaceRate.toFixed(1)}%
                </TableCell>
              </Activity>

              <Activity mode={staminaStats ? 'visible' : 'hidden'}>
                <TableCell className="font-mono">
                  {staminaStats?.uma1.fullSpurtRate.toFixed(1)}%
                </TableCell>
                <TableCell className="font-mono">
                  {staminaStats?.uma1.staminaSurvivalRate.toFixed(1)}%
                </TableCell>
              </Activity>
            </TableRow>

            <TableRow>
              <TableCell className="max-w-40 truncate font-mono text-[#c52a2a] dark:text-red-500 font-bold">
                {names.uma2}
              </TableCell>
              <TableCell className="font-mono">
                {firstUmaStats?.uma2.firstPlaceRate.toFixed(1)}%
              </TableCell>
              <Activity mode={staminaStats ? 'visible' : 'hidden'}>
                <TableCell className="font-mono">
                  {staminaStats?.uma2.fullSpurtRate.toFixed(1)}%
                </TableCell>
                <TableCell className="font-mono">
                  {staminaStats?.uma2.staminaSurvivalRate.toFixed(1)}%
                </TableCell>
              </Activity>
            </TableRow>
          </TableBody>
        </Table>
      </Activity>
    </div>
  );
};
