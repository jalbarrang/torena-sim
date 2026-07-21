import { describe, expect, it } from 'vitest';

import { getTeamTrialsOnboardingState, getTeamTrialsSummaryCopy } from './team-trials-page-state';

describe('Team Trials onboarding state', () => {
  it('keeps the Trainee List empty state for no owned trainees', () => {
    expect(getTeamTrialsOnboardingState({ ownedCount: 0, rosteredCount: 0 })).toBe('no-owned');
  });

  it('distinguishes owned trainees with an empty roster', () => {
    expect(getTeamTrialsOnboardingState({ ownedCount: 3, rosteredCount: 0 })).toBe(
      'owned-unrostered'
    );
    expect(getTeamTrialsSummaryCopy({ rosteredCount: 0, perfectFitCount: 0 })).toEqual({
      aptitudeFitValue: '—',
      aptitudeFitCaption: 'aptitude fit · 0 rostered',
      baseScoreCaption: 'Add members to project a score',
      projectedScoreCaption: 'Add members to project a score'
    });
  });

  it('shows live aptitude and sheet copy once members are rostered', () => {
    expect(getTeamTrialsOnboardingState({ ownedCount: 3, rosteredCount: 2 })).toBe('rostered');
    expect(getTeamTrialsSummaryCopy({ rosteredCount: 2, perfectFitCount: 1 })).toEqual({
      aptitudeFitValue: '1 of 2 A/A',
      aptitudeFitCaption: 'aptitude fit, no multiplier loss',
      baseScoreCaption: 'base score from the sheet below',
      projectedScoreCaption: 'projected run total after multipliers'
    });
  });
});
