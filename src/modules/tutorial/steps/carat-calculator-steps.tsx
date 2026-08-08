import type { TutorialStep } from '@/components/tutorial';
import {
  revealPlanAssumptions,
  setPlanAssumptionsBandOpen
} from '@/modules/carat/components/plan-assumptions-band-state';

const Term = (props: { children: React.ReactNode }) => {
  const { children } = props;
  return <code className="rounded-md bg-muted p-1 font-mono text-foreground">{children}</code>;
};

export const caratCalculatorSteps: Array<TutorialStep> = [
  {
    title: 'Plan your pulls in 60 seconds ✨',
    description: (
      <div className="flex flex-col gap-2 text-muted-foreground">
        <div>
          Use this calculator to decide which banners you can afford before they arrive on Global.
        </div>
        <div>
          You will set your income, add banners, enter planned pulls, then check whether each plan
          is
          <strong className="text-foreground"> affordable</strong>.
        </div>
      </div>
    ),
    showButtons: ['next', 'close']
  },
  {
    element: '[data-tutorial="carat-starting-resources"]',
    onBeforeStep: () => revealPlanAssumptions('balance'),
    title: 'Start with your base resources',
    description: (
      <div className="flex flex-col gap-2 text-muted-foreground">
        <div>
          Everything the projection assumes lives in{' '}
          <strong className="text-foreground">Plan assumptions</strong>, above the plan. It stays
          collapsed and summarizes itself, so you can open it only when something looks off.
        </div>
        <div>
          In <strong className="text-foreground">Balance</strong>, enter your base free carats, paid
          carats, and tickets. Your plan starts from these.
        </div>
      </div>
    ),
    side: 'bottom',
    align: 'start',
    showButtons: ['previous', 'next', 'close']
  },
  {
    element: '[data-tutorial="carat-settings"]',
    onBeforeStep: () => revealPlanAssumptions('income'),
    title: 'Set your recurring income',
    description: (
      <div className="flex flex-col gap-2 text-muted-foreground">
        <div>
          The <strong className="text-foreground">Income</strong> group configures recurring income
          from monthly rewards, tickets, Team Trials, club rank, and optional packs.
        </div>
        <div>
          The <strong className="text-foreground">Rewards</strong> group next to it lists the event
          and calendar rewards already counted for you.
        </div>
      </div>
    ),
    side: 'bottom',
    align: 'start',
    showButtons: ['previous', 'next', 'close']
  },
  {
    element: '[data-tutorial="carat-summary"]',
    onBeforeStep: () => setPlanAssumptionsBandOpen(false),
    title: 'Read the top-line summary',
    description: (
      <div className="flex flex-col gap-2 text-muted-foreground">
        <div>
          This strip summarizes your current stash, all-in monthly income, planned spend, and final
          balance after the last banner in your plan.
        </div>
        <div>
          Monthly Income averages a full year of projected income — recurring rewards plus Champions
          Meeting, League of Heroes, and timeline events — per 30 days. Open its breakdown to
          reconcile against other calculators.
        </div>
        <div>
          If it says <strong className="text-foreground">Affordable ✓</strong>, your full plan fits
          the current assumptions.
        </div>
      </div>
    ),
    side: 'bottom',
    align: 'center',
    showButtons: ['previous', 'next', 'close']
  },
  {
    element: '[data-tutorial="carat-add-banner"]',
    title: 'Add banners from the live timeline',
    description: (
      <div className="flex flex-col gap-2 text-muted-foreground">
        <div>Pick available character or support banners from the timeline.</div>
        <div>
          Confidence badges mean <strong className="text-foreground">Confirmed</strong>, estimated
          from JP spacing, or longer-range <strong className="text-foreground">Predicted</strong>.
        </div>
      </div>
    ),
    side: 'bottom',
    align: 'end',
    showButtons: ['previous', 'next', 'close']
  },
  {
    element: '[data-tutorial="carat-pulls-input"]',
    title: 'Set planned pulls',
    description: (
      <div className="flex flex-col gap-2 text-muted-foreground">
        <div>Enter how many pulls you plan to spend on each banner.</div>
        <div>
          <Term>1 spark</Term> sets <strong className="text-foreground">200 pulls</strong>, the pity
          point where you can exchange for one guaranteed pickup copy.
        </div>
      </div>
    ),
    side: 'left',
    align: 'center',
    showButtons: ['previous', 'next', 'close']
  },
  {
    element: '[data-tutorial="carat-odds"]',
    title: 'Understand copy odds',
    description: (
      <div className="flex flex-col gap-2 text-muted-foreground">
        <div>
          The odds bar estimates your chance to land <Term>0LB</Term> through <Term>MLB</Term>{' '}
          copies.
        </div>
        <div>
          Sparks/pity help guarantee copies, but random rate-up copies still decide how likely MLB
          is.
        </div>
      </div>
    ),
    side: 'left',
    align: 'center',
    showButtons: ['previous', 'next', 'close']
  },
  {
    title: 'You are ready to plan 🎉',
    description: (
      <div className="flex flex-col gap-2 text-muted-foreground">
        <div>
          Try adding one must-pull banner, set it to <Term>200</Term> pulls, and watch the balance.
        </div>
        <div>Then add lower-priority banners until the plan stops being affordable.</div>
      </div>
    ),
    showButtons: ['previous', 'next'],
    doneBtnText: 'Start planning'
  }
];
