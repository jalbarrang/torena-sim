import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useTutorial } from '@/components/tutorial';
import { caratCalculatorSteps } from '@/modules/tutorial/steps/carat-calculator-steps';
import { AddBannerButton } from '@/modules/carat/components/add-banner-button';
import { PlanAssumptionsBand } from '@/modules/carat/components/plan-assumptions-band';
import { PlanSwitcher } from '@/modules/carat/components/plan-switcher';
import { SummaryStats } from '@/modules/carat/components/summary-stats';
import { TimelinePanel } from '@/modules/carat/components/timeline-panel';
import {
  completeTutorial,
  dismissTutorial,
  markVisited,
  useIsFirstVisit,
  useTutorialStatus
} from '@/store/tutorial.store';

export function CaratCalculatorPage() {
  const { start, isActive, tutorialId } = useTutorial();
  const wasCaratTourActive = useRef(false);
  const isFirstVisit = useIsFirstVisit('carat-calculator');
  const { isCompleted, isDismissed } = useTutorialStatus('carat-calculator');
  const [isFirstVisitNudgeOpen, setIsFirstVisitNudgeOpen] = useState(
    () => isFirstVisit && !isCompleted && !isDismissed
  );
  const showFirstVisitNudge = isFirstVisitNudgeOpen && !isCompleted && !isDismissed;

  useEffect(() => {
    if (isFirstVisitNudgeOpen) {
      markVisited('carat-calculator');
    }
  }, [isFirstVisitNudgeOpen]);

  useEffect(() => {
    if (isActive && tutorialId === 'carat-calculator') {
      wasCaratTourActive.current = true;
      return;
    }

    if (wasCaratTourActive.current) {
      completeTutorial('carat-calculator');
      wasCaratTourActive.current = false;
    }
  }, [isActive, tutorialId]);

  const startTour = () => {
    setIsFirstVisitNudgeOpen(false);
    start('carat-calculator', caratCalculatorSteps);
  };

  const dismissFirstVisitNudge = () => {
    setIsFirstVisitNudgeOpen(false);
    dismissTutorial('carat-calculator');
  };

  return (
    <div className="flex w-full min-h-0 flex-col gap-2 overflow-y-auto px-4 py-4">
      {/* Header */}
      <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Pull Planner</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Plan your pulls against the live banner timeline
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <PlanSwitcher />
          <Button size="sm" variant="outline" onClick={startTour}>
            Take a tour
          </Button>
        </div>
      </div>

      {/* First visit nudge */}
      {showFirstVisitNudge ? (
        <div className="mb-4 shrink-0 rounded-xl border bg-card p-3 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold">New here? Take a 60-second tour.</div>
              <div className="text-xs text-muted-foreground">
                Learn carats, pulls, sparks, and odds without auto-launching anything.
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={startTour}>
                Start
              </Button>
              <Button size="sm" variant="outline" onClick={dismissFirstVisitNudge}>
                Dismiss
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Disclaimer */}
      <p className="shrink-0 text-xs leading-relaxed text-muted-foreground">
        Estimates only. Odds use independent-probability models and are not guarantees — your actual
        results will vary. This is not financial advice; only spend what you can comfortably afford.
      </p>

      {/* Planner — one column, so the plan gets the full content width. */}
      <div className="flex min-w-0 flex-col gap-2">
        <PlanAssumptionsBand />

        <SummaryStats />

        <section
          data-tutorial="carat-planner"
          className="flex min-w-0 flex-col rounded-xl border bg-card shadow-sm"
        >
          <div className="flex shrink-0 flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <strong className="text-sm">Banner Plan</strong>
            <div className="flex items-center gap-2">
              <AddBannerButton showFirstVisitNudge={showFirstVisitNudge} />
            </div>
          </div>

          <div className="relative flex min-w-0 flex-col p-4 [&>*]:min-w-0">
            <TimelinePanel showFirstVisitNudge={showFirstVisitNudge} />
          </div>
        </section>
      </div>
    </div>
  );
}
