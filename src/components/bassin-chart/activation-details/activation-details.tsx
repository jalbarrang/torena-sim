import { lazy, Suspense, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { ChartLoadingFallback } from '@/components/charts/chart-loading-fallback';
import {
  LazyActivationEffectChart,
  LazyLengthDifferenceChart,
  LazyVelocityComparisonChart
} from '../charts/lazy-charts';
import type {
  SkillSimulationData,
  SkillTrackedMetaCollection
} from '@/modules/simulation/compare.types';
import { CourseService } from '@/modules/data/services/CourseService';
import React from 'react';

const LazyHistogram = lazy(() =>
  import('@/components/Histogram').then((module) => ({ default: module.Histogram }))
);

type ActivationDetailsProps = {
  skillId: string;
  runData: SkillSimulationData;
  skillActivations: Record<string, SkillTrackedMetaCollection>;
  results: Array<number>;
  courseDistance: number;
  currentSeed: number | null;
  isGlobalSimulationRunning: boolean;
  isSkillLoading?: boolean;
  onRunAdditionalSamples?: (skillId: string, additionalSamples: number) => void;
};

// Component to show detailed activation info in expanded row
export const ActivationDetails = React.memo((props: ActivationDetailsProps) => {
  const {
    skillId,
    skillActivations,
    results,
    runData,
    courseDistance,
    currentSeed,
    isGlobalSimulationRunning,
    isSkillLoading = false,
    onRunAdditionalSamples
  } = props;

  const currentSkillActivations = useMemo(
    () => skillActivations[skillId],
    [skillId, skillActivations]
  );

  const activationPositions = useMemo(
    () => currentSkillActivations.flatMap((activation) => activation.positions),
    [currentSkillActivations]
  );

  const totalActivations = activationPositions.length;
  const hasActivations = totalActivations > 0;

  // `results` arrives sorted from the simulators.
  const median = useMemo(() => {
    if (results.length === 0) return 0;
    const mid = Math.floor(results.length / 2);
    return results.length % 2 === 0 ? (results[mid - 1] + results[mid]) / 2 : results[mid];
  }, [results]);

  const stats = useMemo(() => {
    let earliestPosition = 0;
    let latestPosition = 0;
    let averagePosition = 0;
    let primaryPhase = '';

    if (hasActivations) {
      const sorted = activationPositions.sort((a, b) => a - b);

      earliestPosition = sorted[0];
      latestPosition = sorted[sorted.length - 1];
      averagePosition = activationPositions.reduce((sum, pos) => sum + pos, 0) / totalActivations;

      // Determine primary activation phase using CourseHelpers
      const phase1Start = CourseService.phaseStart(courseDistance, 1);
      const phase2Start = CourseService.phaseStart(courseDistance, 2);
      const phase3Start = CourseService.phaseStart(courseDistance, 3);

      if (averagePosition < phase1Start) {
        primaryPhase = 'Early Race';
      } else if (averagePosition < phase2Start) {
        primaryPhase = 'Mid Race';
      } else if (averagePosition < phase3Start) {
        primaryPhase = 'Late Race';
      } else {
        primaryPhase = 'Last Spurt';
      }
    }

    return {
      earliestPosition,
      latestPosition,
      averagePosition,
      primaryPhase
    };
  }, [activationPositions, courseDistance, hasActivations, totalActivations]);

  if (!hasActivations) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <div className="text-sm text-muted-foreground">
            No activation data available - this skill did not activate in any simulation runs.
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            This may indicate that the skill's activation conditions are not met for this race
            configuration.
          </div>
        </CardContent>
      </Card>
    );
  }

  const canRunAdditionalSamples =
    currentSeed !== null && !isGlobalSimulationRunning && !isSkillLoading && onRunAdditionalSamples;

  const handleRunAdditionalSamples = () => {
    if (onRunAdditionalSamples) {
      onRunAdditionalSamples(skillId, 1000);
    }
  };

  return (
    <Card className="rounded-none">
      <CardHeader className="border-b">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Skill Activation Analysis</CardTitle>

          <div className="flex items-center gap-4 text-xs">
            {/* <div className="flex items-end gap-1">
              <span className="text-muted-foreground">Avg. Proc Position:</span>
              <span className="font-semibold">{Math.round(stats.averagePosition)}m</span>
            </div> */}
            <div className="flex items-end gap-1">
              <span className="text-muted-foreground">Proc Range: </span>
              <span className="font-semibold">
                {Math.round(stats.earliestPosition)}-{Math.round(stats.latestPosition)}m
              </span>
            </div>
            {/* <div className="flex items-end gap-1">
              <span className="text-muted-foreground">Primary Phase: </span>
              <span className="font-semibold">{stats.primaryPhase}</span>
            </div> */}
            <div className="flex items-end gap-1">
              <span className="text-muted-foreground">Samples: </span>
              <span className="font-semibold">{totalActivations}</span>
            </div>

            {isSkillLoading && (
              <Badge variant="secondary" className="gap-1">
                <Loader2 className="size-3 animate-spin" />
                Running…
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col divide-y divide-border [&>section]:py-4 [&>section:first-child]:pt-0 [&>section:last-child]:pb-0">
        {/* 1. Headline answer: how much does this skill gain across all runs */}
        {results.length > 0 && (
          <section className="flex flex-col gap-2">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold">Bashin Gain Distribution</h3>
                <p className="text-xs text-muted-foreground">
                  Lengths gained versus the baseline in each of the {results.length} runs.
                </p>
              </div>

              {onRunAdditionalSamples && (
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRunAdditionalSamples}
                    disabled={!canRunAdditionalSamples}
                    className="gap-1"
                  >
                    {isSkillLoading ? (
                      <>
                        <Loader2 className="animate-spin" />
                        Running…
                      </>
                    ) : (
                      <>Run +1000 Samples</>
                    )}
                  </Button>

                  {!currentSeed && (
                    <span className="text-xs text-muted-foreground">
                      Run a simulation first
                    </span>
                  )}
                </div>
              )}
            </div>

            <Suspense fallback={<ChartLoadingFallback height={240} />}>
              <LazyHistogram
                data={results}
                className="w-full max-w-none aspect-auto h-[240px]"
                marker={{ value: median, label: 'Median' }}
              />
            </Suspense>
          </section>
        )}

        {/* 2. Mechanism: what the skill does to one representative run */}
        <section className="flex flex-col gap-2">
          <Suspense fallback={<ChartLoadingFallback height={240} />}>
            <LazyVelocityComparisonChart skillId={skillId} runData={runData} />
          </Suspense>
        </section>

        {/* 3. Course analysis: where along the track it procs and pays off */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-sm font-semibold">Course Analysis</h3>

            <div className="flex items-center gap-3 text-xs">
              <div className="flex items-center gap-1">
                <div className="size-3 rounded" style={{ backgroundColor: 'rgb(0,154,111)' }} />
                <span className="text-muted-foreground">Early Race</span>
              </div>

              <div className="flex items-center gap-1">
                <div className="size-3 rounded" style={{ backgroundColor: 'rgb(242,233,103)' }} />
                <span className="text-muted-foreground">Mid Race</span>
              </div>

              <div className="flex items-center gap-1">
                <div className="size-3 rounded" style={{ backgroundColor: 'rgb(209,134,175)' }} />
                <span className="text-muted-foreground">Late Race</span>
              </div>

              <div className="flex items-center gap-1">
                <div className="size-3 rounded" style={{ backgroundColor: 'rgb(255,130,130)' }} />
                <span className="text-muted-foreground">Last Spurt</span>
              </div>
            </div>
          </div>

          <Suspense
            fallback={
              <div className="flex flex-col gap-4">
                <ChartLoadingFallback height={240} />
                <ChartLoadingFallback height={240} />
              </div>
            }
          >
            {/* Stacked full-width: both charts share the course x-axis, so
                vertical alignment lets procs and payoff be read straight down. */}
            <div className="flex flex-col gap-4">
              <LazyActivationEffectChart
                skillId={skillId}
                skillActivations={activationPositions}
                courseDistance={courseDistance}
              />
              <LazyLengthDifferenceChart
                skillId={skillId}
                skillActivations={skillActivations}
                courseDistance={courseDistance}
              />
            </div>
          </Suspense>
        </section>
      </CardContent>
    </Card>
  );
});
