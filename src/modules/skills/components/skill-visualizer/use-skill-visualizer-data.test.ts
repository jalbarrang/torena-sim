import { describe, expect, it } from 'vitest';
import { computeSkillVisualizerData } from './use-skill-visualizer-data';

const NAKAYAMA_1200_TURF = 10501;

// "Let's Pump Some Iron!" (Mejiro Ryan unique): phase>=2&corner!=0&order_rate>=65&order_rate<=70.
// 65–70% of a 9-uma field is exactly 6th place — outside every strategy's typical position band
// except Late Surger/End Closer, so it only renders via the position-probing fallback.
const PUMP_SOME_IRON = '100271';

// "Taking the Lead": running_style==1&phase==0. Requires the Front Runner strategy fallback.
const TAKING_THE_LEAD = '200531';

// "Professor of Curvature": all_corner_random==1. Activates under the default assumptions.
const PROFESSOR_OF_CURVATURE = '200331';

function entryFor(skillId: string, courseId = NAKAYAMA_1200_TURF) {
  const { entries } = computeSkillVisualizerData([skillId], courseId);
  return entries[0];
}

describe('computeSkillVisualizerData', () => {
  it('visualizes position-gated skills via the position-probing fallback', () => {
    const entry = entryFor(PUMP_SOME_IRON);

    expect(entry.status).toBe('ok');
    expect(entry.triggers.length).toBeGreaterThan(0);
  });

  it('visualizes strategy-restricted skills via the strategy fallback', () => {
    const entry = entryFor(TAKING_THE_LEAD);

    expect(entry.status).toBe('ok');
    expect(entry.triggers.length).toBeGreaterThan(0);
  });

  it('visualizes skills that activate under the default assumptions', () => {
    const entry = entryFor(PROFESSOR_OF_CURVATURE);

    expect(entry.status).toBe('ok');
    expect(entry.triggers.length).toBeGreaterThan(0);
  });
});
