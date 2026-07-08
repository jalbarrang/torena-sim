import { lazy, Suspense, useMemo } from 'react';
import { BarChart3 } from 'lucide-react';
import { useRaceStore } from '@/modules/simulation/stores/compare.store';
import { ChartLoadingFallback } from '@/components/charts/chart-loading-fallback';
import { useComparePairNames } from '@/modules/runners/hooks/use-compare-names';

const LazyHistogram = lazy(() =>
  import('@/components/Histogram').then((module) => ({ default: module.Histogram }))
);
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';

export const DistributionTab = () => {
  const { results } = useRaceStore();
  const names = useComparePairNames();

  const distributionStats = useMemo(() => {
    if (results.length === 0) return null;

    const sorted = results.toSorted((a, b) => a - b);
    const n = sorted.length;
    const mean = sorted.reduce((a, b) => a + b, 0) / n;
    const variance = sorted.reduce((sum, x) => sum + (x - mean) ** 2, 0) / n;
    const stdDev = Math.sqrt(variance);

    // Percentiles
    const p5 = sorted[Math.floor(n * 0.05)];
    const p25 = sorted[Math.floor(n * 0.25)];
    const p50 = sorted[Math.floor(n * 0.5)];
    const p75 = sorted[Math.floor(n * 0.75)];
    const p95 = sorted[Math.floor(n * 0.95)];

    // Win rates
    const uma1Wins = sorted.filter((x) => x < 0).length;
    const uma2Wins = sorted.filter((x) => x > 0).length;
    const ties = sorted.filter((x) => x === 0).length;

    return {
      mean,
      stdDev,
      range: sorted[n - 1] - sorted[0],
      percentiles: { p5, p25, p50, p75, p95 },
      winRates: {
        uma1: ((uma1Wins / n) * 100).toFixed(1),
        uma2: ((uma2Wins / n) * 100).toFixed(1),
        tie: ((ties / n) * 100).toFixed(1)
      },
      sampleSize: n
    };
  }, [results]);

  if (!distributionStats) {
    return (
      <Empty className="py-12">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BarChart3 />
          </EmptyMedia>
          <EmptyTitle>No Distribution Data</EmptyTitle>
          <EmptyDescription>
            Run simulations to see win rate distribution, percentiles, and statistical analysis.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      <div className="flex flex-col gap-2">
        {/* Basic Stats */}
        <div className="bg-background border-2 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-foreground mb-3">Basic Statistics</h4>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-foreground">Mean:</span>
              <span className="font-mono font-medium">
                {distributionStats.mean.toFixed(3)} lengths
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-foreground">Std Dev:</span>
              <span className="font-mono font-medium">
                {distributionStats.stdDev.toFixed(3)} lengths
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-foreground">Range:</span>
              <span className="font-mono font-medium">
                {distributionStats.range.toFixed(3)} lengths
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-foreground">Sample Size:</span>
              <span className="font-mono font-medium">{distributionStats.sampleSize}</span>
            </div>
          </div>
        </div>

        {/* Percentiles */}
        <div className="bg-background border-2 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-foreground mb-3">Percentiles</h4>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-foreground">5th:</span>
              <span className="font-mono font-medium">
                {distributionStats.percentiles.p5.toFixed(3)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-foreground">25th:</span>
              <span className="font-mono font-medium">
                {distributionStats.percentiles.p25.toFixed(3)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-foreground">50th (Median):</span>
              <span className="font-mono font-medium">
                {distributionStats.percentiles.p50.toFixed(3)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-foreground">75th:</span>
              <span className="font-mono font-medium">
                {distributionStats.percentiles.p75.toFixed(3)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-foreground">95th:</span>
              <span className="font-mono font-medium">
                {distributionStats.percentiles.p95.toFixed(3)}
              </span>
            </div>
          </div>
        </div>

        {/* Win Rates */}
        <div className="bg-background border-2 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-foreground mb-3">Win Distribution</h4>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="max-w-56 truncate text-[#2a77c5] dark:text-blue-500 font-medium">
                  {names.uma1} wins
                </span>
                <span className="font-mono font-bold text-[#2a77c5]">
                  {distributionStats.winRates.uma1}%
                </span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#2a77c5] transition-all"
                  style={{ width: `${distributionStats.winRates.uma1}%` }}
                />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="max-w-56 truncate text-[#c52a2a] font-medium">
                  {names.uma2} wins
                </span>
                <span className="font-mono font-bold text-[#c52a2a]">
                  {distributionStats.winRates.uma2}%
                </span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#c52a2a] transition-all"
                  style={{ width: `${distributionStats.winRates.uma2}%` }}
                />
              </div>
            </div>
            {Number.parseFloat(distributionStats.winRates.tie) > 0 && (
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-muted-foreground font-medium">Ties</span>
                  <span className="font-mono font-bold text-muted-foreground">
                    {distributionStats.winRates.tie}%
                  </span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-muted-foreground transition-all"
                    style={{ width: `${distributionStats.winRates.tie}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div>
        {/* Full-width Histogram */}
        <div className="w-full">
          <h3 className="text-lg font-semibold text-foreground mb-3">Result Distribution</h3>
          <div className="flex justify-center h-[300px]">
            <Suspense fallback={<ChartLoadingFallback className="w-full max-w-[600px]" />}>
              <LazyHistogram data={results} className="w-full" />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
};
