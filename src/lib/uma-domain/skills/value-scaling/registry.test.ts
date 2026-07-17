import { describe, expect, it } from 'vitest';
import { activatedTaggedMultiplier, resolveActivatedTagCountDisplay } from './activated-tag-count';
import { describeValueScaling, supportedSimulatableValueUsages } from './registry';

describe('value-scaling descriptor registry', () => {
  it('keeps Direct effects on the numeric display fallback', () => {
    expect(describeValueScaling({ type: 27, modifier: 0.25 })).toBeNull();
    expect(describeValueScaling({ type: 27, modifier: 0.25, valueUsage: 1 })).toBeNull();
  });

  it('describes MultiplyRandom recovery effects from their base modifier', () => {
    expect(describeValueScaling({ type: 9, modifier: -1, valueUsage: 8 })).toBe(
      '60% chance to drain nothing, 30% to drain 2%, 10% to drain 4%'
    );
  });

  it('describes Aoharu team-stats scaling (Ignited Spirit, usage 5)', () => {
    expect(describeValueScaling({ type: 31, modifier: 0.2, valueUsage: 5 })).toBe(
      'Scales with Aoharu team stats in-scenario; base value (1.0×) in normal races'
    );
  });

  it('describes the activated-green tier rule', () => {
    expect(describeValueScaling({ type: 27, modifier: 0.05, valueUsage: 14 })).toBe(
      'Activated greens: 0–2 → 0×, 3–4 → 1×, 5 → 2×, 6+ → 3×'
    );
  });

  it('marks unimplemented policies instead of showing a flat number', () => {
    expect(describeValueScaling({ type: 27, modifier: 0.05, valueUsage: 13 })).toBe(
      'Special scaling (usage 13) — not yet simulated'
    );
  });

  it('derives the simulator-supported usages from descriptors', () => {
    expect(Array.from(supportedSimulatableValueUsages).sort((a, b) => a - b)).toEqual([
      1, 3, 4, 5, 6, 7, 8, 9, 14
    ]);
  });

  it.each([
    [2, 0],
    [3, 1],
    [5, 2],
    [6, 3]
  ])('uses the Rust usage-14 tier at %i greens', (greens, multiplier) => {
    expect(activatedTaggedMultiplier(greens)).toBe(multiplier);
  });

  it('resolves a known green count into the scaled display value', () => {
    expect(
      resolveActivatedTagCountDisplay({ type: 27, modifier: 0.05 }, { activatedGreenCount: 6 })
    ).toBe('6 activated greens → 3× → +0.15');
  });
});
