import { useEffect, useRef, useState } from 'react';

import { useTutorial } from '@/components/tutorial';
import { Button } from '@/components/ui/button';
import { buildTeamTrialsSteps } from '@/modules/tutorial/steps/team-trials-steps';
import {
  completeTutorial,
  dismissTutorial,
  markVisited,
  useIsFirstVisit,
  useTutorialStatus
} from '@/store/tutorial.store';
import type { TeamTrialsOnboardingState } from './team-trials-page-state';

type UseTeamTrialsTutorialInput = {
  onboardingState: TeamTrialsOnboardingState;
  rosteredCount: number;
};

export function useTeamTrialsTutorial(input: UseTeamTrialsTutorialInput) {
  const { onboardingState, rosteredCount } = input;
  const { start, isActive, tutorialId } = useTutorial();
  const wasTeamTrialsTourActive = useRef(false);
  const isFirstVisit = useIsFirstVisit('team-trials');
  const { isCompleted, isDismissed } = useTutorialStatus('team-trials');
  const [isFirstVisitNudgeOpen, setIsFirstVisitNudgeOpen] = useState(
    () => isFirstVisit && !isCompleted && !isDismissed
  );

  const showFirstVisitNudge =
    onboardingState !== 'no-owned' && isFirstVisitNudgeOpen && !isCompleted && !isDismissed;

  useEffect(() => {
    if (isFirstVisitNudgeOpen && onboardingState !== 'no-owned') {
      markVisited('team-trials');
    }
  }, [isFirstVisitNudgeOpen, onboardingState]);

  useEffect(() => {
    if (isActive && tutorialId === 'team-trials') {
      wasTeamTrialsTourActive.current = true;
      return;
    }

    if (wasTeamTrialsTourActive.current) {
      completeTutorial('team-trials');
      wasTeamTrialsTourActive.current = false;
    }
  }, [isActive, tutorialId]);

  const startTour = () => {
    setIsFirstVisitNudgeOpen(false);
    start('team-trials', buildTeamTrialsSteps({ rosteredCount }));
  };

  const dismissFirstVisitNudge = () => {
    setIsFirstVisitNudgeOpen(false);
    dismissTutorial('team-trials');
  };

  return { dismissFirstVisitNudge, showFirstVisitNudge, startTour };
}

type TeamTrialsTutorialNudgeProps = {
  onDismiss: () => void;
  onStart: () => void;
};

export function TeamTrialsTutorialNudge(props: TeamTrialsTutorialNudgeProps) {
  const { onDismiss, onStart } = props;

  return (
    <div className="rounded-xl border bg-card p-3 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold">New here? Take a 60-second tour.</div>
          <div className="text-xs text-muted-foreground">
            Learn how roster building, score rules, and multipliers fit together.
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={onStart}>
            Start
          </Button>
          <Button size="sm" variant="outline" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      </div>
    </div>
  );
}
