import { describe, expect, it } from 'vitest';
import { activatedTaggedMultiplier } from './activated-tag-count';
import {
  buildValueScalingDisplay,
  describeValueScaling,
  supportedSimulatableValueUsages
} from './registry';

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
      'Scales with racing-team stats (0.8–1.2×); best tier (1.2×) already applied'
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

  it.each([
    [0, 0, 0],
    [2, 0, 0],
    [3, 1, 1],
    [5, 2, 2],
    [6, 3, 3]
  ])(
    'builds the usage-14 display at %i active greens',
    (activatedGreenCount, multiplier, activeTierIndex) => {
      const [model] = buildValueScalingDisplay(
        [
          { type: 27, modifier: 0.05, valueUsage: 14 },
          { type: 31, modifier: 0.05, valueUsage: 14 }
        ],
        { activatedGreenCount }
      );

      expect(model).toMatchObject({
        usage: 14,
        resolution: 'resolved',
        activeTierIndex,
        trailing: `${activatedGreenCount} active → ${multiplier}×`
      });
      expect(model.rows).toEqual(
        multiplier === 0
          ? undefined
          : [
              { effectType: 27, base: 0.05, multiplier, result: 0.05 * multiplier },
              { effectType: 31, base: 0.05, multiplier, result: 0.05 * multiplier }
            ]
      );
    }
  );

  it('builds the Aoharu best-tier display from pre-fudged values', () => {
    const [model] = buildValueScalingDisplay([{ type: 31, modifier: 0.24, valueUsage: 5 }], {});

    expect(model).toMatchObject({
      usage: 5,
      header: 'Scales with racing-team stats',
      resolution: 'fixed',
      activeTierIndex: 4,
      trailing: 'best tier pre-applied → 1.2×'
    });
    expect(model.rows?.[0]).toMatchObject({
      effectType: 31,
      multiplier: 1.2,
      result: 0.24
    });
    expect(model.rows?.[0].base).toBeCloseTo(0.2);
  });

  it('builds an unsupported Climax display without marking usage 10 simulatable', () => {
    const [model] = buildValueScalingDisplay([{ type: 27, modifier: 0.06, valueUsage: 10 }], {});

    expect(model).toMatchObject({
      usage: 10,
      header: 'Scales with training races won',
      resolution: 'unsupported',
      activeTierIndex: 4,
      trailing: 'best tier pre-applied → 1.2×'
    });
    expect(model.rows?.[0].base).toBeCloseTo(0.05);
    expect(supportedSimulatableValueUsages.has(10)).toBe(false);
  });

  it('does not build blocks for direct and multiply-random effects', () => {
    expect(
      buildValueScalingDisplay(
        [
          { type: 27, modifier: 0.25, valueUsage: 1 },
          { type: 9, modifier: 1, valueUsage: 8 }
        ],
        {}
      )
    ).toEqual([]);
  });
});
