import { describe, expect, it } from 'vitest';

import { buildTeamTrialsSteps } from './team-trials-steps';

const AUTO_FILL_SELECTOR = '[data-tutorial="team-trials-autofill"]';

describe('buildTeamTrialsSteps', () => {
  it('includes the interactive Auto-fill step for an empty roster', () => {
    const steps = buildTeamTrialsSteps({ rosteredCount: 0 });

    expect(steps.map((step) => step.element)).toContain(AUTO_FILL_SELECTOR);
    expect(steps).toHaveLength(8);
  });

  it('omits the Auto-fill step when the roster already has members', () => {
    const steps = buildTeamTrialsSteps({ rosteredCount: 5 });

    expect(steps.map((step) => step.element)).not.toContain(AUTO_FILL_SELECTOR);
    expect(steps).toHaveLength(7);
  });

  it('opens and closes with centered dialog steps', () => {
    const steps = buildTeamTrialsSteps({ rosteredCount: 0 });

    expect(steps.at(0)?.element).toBeUndefined();
    expect(steps.at(-1)?.element).toBeUndefined();
  });
});
