import type { PRNG } from '../shared/random';
import { SkillType } from './definitions';
import { MULTIPLY_RANDOM_RECOVERY_FACTORS } from './value-scaling/multiply-random';

export type RecoveryEffectLike = {
  type: number;
  modifier: number;
  valueUsage?: number;
  valueLevelUsage?: number;
};

function isSupportedMultiplyRandomRecovery(effect: RecoveryEffectLike): boolean {
  return effect.type === SkillType.Recovery && (effect.valueUsage === 8 || effect.valueUsage === 9);
}

export function isSupportedMultiplyRandomRecoveryDrain(effect: RecoveryEffectLike): boolean {
  return isSupportedMultiplyRandomRecovery(effect) && effect.modifier < 0;
}

export function resolveRecoveryModifier(
  effect: RecoveryEffectLike,
  skillRng?: Pick<PRNG, 'random'> | null,
  override?: number | null
): number {
  if (effect.type !== SkillType.Recovery) {
    return effect.modifier;
  }

  if (effect.modifier < 0 && override != null && Number.isFinite(override)) {
    return -Math.min(Math.max(override, 0), 1);
  }

  if (!isSupportedMultiplyRandomRecovery(effect)) {
    return effect.modifier;
  }

  if (!skillRng) {
    throw new Error('skillRng is required to resolve MultiplyRandom recovery effects');
  }

  const roll = skillRng.random();
  if (roll < 0.6) {
    return 0;
  }
  if (roll < 0.9) {
    return effect.modifier * MULTIPLY_RANDOM_RECOVERY_FACTORS.low;
  }
  return effect.modifier * MULTIPLY_RANDOM_RECOVERY_FACTORS.high;
}
