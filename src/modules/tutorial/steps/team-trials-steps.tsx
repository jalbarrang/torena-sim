import type { TutorialStep } from '@/components/tutorial';

type TeamTrialsStepsInput = {
  rosteredCount: number;
};

const StepDescription = (props: { children: React.ReactNode }) => {
  const { children } = props;
  return <div className="flex flex-col gap-2 text-muted-foreground">{children}</div>;
};

const createAutoFillStep = (): TutorialStep => ({
  element: '[data-tutorial="team-trials-autofill"]',
  title: 'Start with an optimized roster',
  description: (
    <StepDescription>
      <div>
        Click <strong className="text-foreground">Auto-fill</strong> now to build a starting roster
        from your owned trainees. The highlighted button stays clickable during the tour.
      </div>
      <div>You can replace members and choose your aces after the tour.</div>
    </StepDescription>
  ),
  side: 'bottom',
  align: 'end',
  showButtons: ['previous', 'next', 'close']
});

export function buildTeamTrialsSteps(input: TeamTrialsStepsInput): Array<TutorialStep> {
  const { rosteredCount } = input;

  const steps: Array<TutorialStep> = [
    {
      title: 'Project your Team Trials score 🏆',
      description: (
        <StepDescription>
          <div>Build five race teams from your owned trainees and estimate a complete run.</div>
          <div>
            You will choose your class, check aptitude fit, enter race results, then apply the
            bonuses that turn base points into your projected score.
          </div>
        </StepDescription>
      ),
      showButtons: ['next', 'close']
    },
    {
      element: '[data-tutorial="team-trials-class"]',
      title: 'Match your in-game class',
      description: (
        <StepDescription>
          <div>Select your current Team Trials class.</div>
          <div>
            Your class controls how many trainees belong in each of the five teams, so set it before
            fine-tuning the roster.
          </div>
        </StepDescription>
      ),
      side: 'bottom',
      align: 'end',
      showButtons: ['previous', 'next', 'close']
    },
    {
      element: '[data-tutorial="team-trials-roster"]',
      title: 'Build one team for every category',
      description: (
        <StepDescription>
          <div>Fill Sprint, Mile, Medium, Long, and Dirt from your owned trainees.</div>
          <div>
            Each character can occupy only one roster slot. Choose an ace for each team, and prefer
            A or S surface and distance aptitude to avoid score loss.
          </div>
        </StepDescription>
      ),
      side: 'top',
      align: 'center',
      showButtons: ['previous', 'next', 'close']
    }
  ];

  if (rosteredCount === 0) {
    steps.push(createAutoFillStep());
  }

  steps.push(
    {
      element: '[data-tutorial="team-trials-summary"]',
      title: 'Read the roster at a glance',
      description: (
        <StepDescription>
          <div>The cards show filled slots, clean aptitude matches, and the calculated score.</div>
          <div>
            The highlighted value is your{' '}
            <strong className="text-foreground">projected run total</strong> after all global
            multipliers.
          </div>
        </StepDescription>
      ),
      side: 'bottom',
      align: 'center',
      showButtons: ['previous', 'next', 'close']
    },
    {
      element: '[data-tutorial="team-trials-score-sheet"]',
      title: 'Enter what happened in each race',
      description: (
        <StepDescription>
          <div>
            Edit placements and winner details for each category. Every total recalculates
            immediately.
          </div>
          <div>Use the help icons for scoring rules, or reset the sheet to discard your edits.</div>
        </StepDescription>
      ),
      side: 'top',
      align: 'start',
      showButtons: ['previous', 'next', 'close']
    },
    {
      element: '[data-tutorial="team-trials-multipliers"]',
      title: 'Apply the bonuses from your run',
      description: (
        <StepDescription>
          <div>Enter your support bonus, campaign bonus, win streak, and opponent rating.</div>
          <div>The panel shows how the base score becomes the final projected total.</div>
        </StepDescription>
      ),
      side: 'left',
      align: 'start',
      showButtons: ['previous', 'next', 'close']
    },
    {
      title: 'Your score forecast is ready 🎉',
      description: (
        <StepDescription>
          <div>Set your real class and use Auto-fill for a quick starting roster.</div>
          <div>Then adjust members, race placements, and multipliers to match your usual runs.</div>
        </StepDescription>
      ),
      showButtons: ['previous', 'next'],
      doneBtnText: 'Start building'
    }
  );

  return steps;
}
