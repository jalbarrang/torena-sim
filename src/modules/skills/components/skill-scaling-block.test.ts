import { describe, expect, it } from 'vitest';
import { roundScalingDisplayValue } from './skill-scaling-block';

describe('roundScalingDisplayValue', () => {
  it.each([
    [0.15000000000000002, 0.15],
    [-0.15000000000000002, -0.15],
    [0.125, 0.13]
  ])('rounds %s to a display value of %s', (value, expected) => {
    expect(roundScalingDisplayValue(value)).toBe(expected);
  });
});
