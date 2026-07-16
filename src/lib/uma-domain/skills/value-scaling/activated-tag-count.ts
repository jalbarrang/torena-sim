import type {
  ScalingEffectLike,
  ValueScalingDescriptor,
  ValueScalingDisplayContext
} from './descriptor.types';

const TIER_RULE = 'Activated greens: 0–2 → 0×, 3–4 → 1×, 5 → 2×, 6+ → 3×';

// Mirrors packages/uma-sim-primitives/src/skills/value_scaling.rs activated_tagged_multiplier.
export function activatedTaggedMultiplier(activatedGreenCount: number): number {
  if (activatedGreenCount <= 2) return 0;
  if (activatedGreenCount <= 4) return 1;
  if (activatedGreenCount === 5) return 2;
  return 3;
}

function formatModifier(modifier: number): string {
  return `${modifier >= 0 ? '+' : ''}${modifier.toFixed(2).replace(/\.0+$/, '')}`;
}

export function resolveActivatedTagCountDisplay(
  effect: ScalingEffectLike,
  context: ValueScalingDisplayContext
): string | null {
  if (context.activatedGreenCount === undefined) {
    return null;
  }

  const multiplier = activatedTaggedMultiplier(context.activatedGreenCount);
  return `${context.activatedGreenCount} activated greens → ${multiplier}× → ${formatModifier(effect.modifier * multiplier)}`;
}

export const activatedTagCountValueScalingDescriptor: ValueScalingDescriptor = Object.freeze({
  usage: [14],
  name: 'MultiplyActivateSpecificTagSkillCount',
  simulatable: true,
  describe: () => TIER_RULE,
  resolveDisplay: resolveActivatedTagCountDisplay
});
