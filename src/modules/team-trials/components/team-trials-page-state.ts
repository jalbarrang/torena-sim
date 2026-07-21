export type TeamTrialsOnboardingState = 'no-owned' | 'owned-unrostered' | 'rostered';

type TeamTrialsPageStateInput = {
  ownedCount: number;
  rosteredCount: number;
};

type TeamTrialsSummaryCopyInput = {
  rosteredCount: number;
  perfectFitCount: number;
};

type TeamTrialsSummaryCopy = {
  aptitudeFitValue: string;
  aptitudeFitCaption: string;
  baseScoreCaption: string;
  projectedScoreCaption: string;
};

export function getTeamTrialsOnboardingState(
  input: TeamTrialsPageStateInput
): TeamTrialsOnboardingState {
  const { ownedCount, rosteredCount } = input;

  if (ownedCount === 0) return 'no-owned';
  if (rosteredCount === 0) return 'owned-unrostered';
  return 'rostered';
}

export function getTeamTrialsSummaryCopy(input: TeamTrialsSummaryCopyInput): TeamTrialsSummaryCopy {
  const { rosteredCount, perfectFitCount } = input;

  if (rosteredCount === 0) {
    return {
      aptitudeFitValue: '—',
      aptitudeFitCaption: 'aptitude fit · 0 rostered',
      baseScoreCaption: 'Add members to project a score',
      projectedScoreCaption: 'Add members to project a score'
    };
  }

  return {
    aptitudeFitValue: `${perfectFitCount} of ${rosteredCount} A/A`,
    aptitudeFitCaption: 'aptitude fit, no multiplier loss',
    baseScoreCaption: 'base score from the sheet below',
    projectedScoreCaption: 'projected run total after multipliers'
  };
}
