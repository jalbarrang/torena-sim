import type {
  ScalingEffectLike,
  ValueScalingDisplayModel,
  ValueScalingDescriptor,
  ValueScalingDisplayContext
} from './descriptor.types';

const TIER_RULE = 'Activated greens: 0–2 → 0×, 3–4 → 1×, 5 → 2×, 6+ → 3×';

const GREEN_TIERS = [
  { label: '0–2', multiplier: 0 },
  { label: '3–4', multiplier: 1 },
  { label: '5', multiplier: 2 },
  { label: '6+', multiplier: 3 }
] as const;

// Mirrors packages/uma-sim-primitives/src/skills/value_scaling.rs activated_tagged_multiplier.
export function activatedTaggedMultiplier(activatedGreenCount: number): number {
  if (activatedGreenCount <= 2) return 0;
  if (activatedGreenCount <= 4) return 1;
  if (activatedGreenCount === 5) return 2;
  return 3;
}

function activeTierIndex(activatedGreenCount: number): number {
  if (activatedGreenCount <= 2) return 0;
  if (activatedGreenCount <= 4) return 1;
  if (activatedGreenCount === 5) return 2;
  return 3;
}

function buildActivatedTagCountDisplay(
  effects: ReadonlyArray<ScalingEffectLike>,
  context: ValueScalingDisplayContext
): ValueScalingDisplayModel {
  if (context.activatedGreenCount === undefined) {
    return {
      usage: 14,
      header: 'Scales with activated greens',
      resolution: 'resolved',
      tiers: GREEN_TIERS,
      notes: ['The exact bonus is determined after green skills activate during the race.']
    };
  }

  const { activatedGreenCount } = context;
  const multiplier = activatedTaggedMultiplier(activatedGreenCount);
  if (multiplier === 0) {
    return {
      usage: 14,
      header: 'Scales with activated greens',
      resolution: 'resolved',
      tiers: GREEN_TIERS,
      activeTierIndex: activeTierIndex(activatedGreenCount),
      trailing: `${activatedGreenCount} active → 0×`,
      notes: ['No bonus below 3 active greens.']
    };
  }

  return {
    usage: 14,
    header: 'Scales with activated greens',
    resolution: 'resolved',
    tiers: GREEN_TIERS,
    activeTierIndex: activeTierIndex(activatedGreenCount),
    trailing: `${activatedGreenCount} active → ${multiplier}×`,
    rows: effects.map((effect) => ({
      effectType: effect.type,
      base: effect.modifier,
      multiplier,
      result: effect.modifier * multiplier
    }))
  };
}

export const activatedTagCountValueScalingDescriptor: ValueScalingDescriptor = Object.freeze({
  usage: [14],
  name: 'MultiplyActivateSpecificTagSkillCount',
  simulatable: true,
  describe: () => TIER_RULE,
  buildDisplay: buildActivatedTagCountDisplay
});
