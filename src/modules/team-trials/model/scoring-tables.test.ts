import { describe, expect, it } from 'vitest';
import {
  FINISH_POSITION_POINTS,
  RUNNING_STYLE_EVALUATION_RATES,
  SURFACE_AND_DISTANCE_EVALUATION_RATES,
  UNIQUE_SKILL_PROC_POINTS
} from './scoring-tables';

describe('Team Trials scoring tables', () => {
  it('uses a 1.0 evaluation rate for A aptitudes', () => {
    const fit =
      SURFACE_AND_DISTANCE_EVALUATION_RATES.A *
      SURFACE_AND_DISTANCE_EVALUATION_RATES.A *
      RUNNING_STYLE_EVALUATION_RATES.A;

    expect(fit).toBe(1);
  });

  it('awards 10,000 points for first place', () => {
    expect(FINISH_POSITION_POINTS[1]).toBe(10_000);
  });

  it('awards 2,500 points for a level-five 3-star-base unique skill proc', () => {
    expect(UNIQUE_SKILL_PROC_POINTS[3][5]).toBe(2_500);
  });
});
