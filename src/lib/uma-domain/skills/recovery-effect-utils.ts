import type { PRNG } from '../shared/random';
import { SkillType } from './definitions';

export type RecoveryEffectLike = {
  type: number;
  modifier: number;
  valueUsage?: number;
  valueLevelUsage?: number;
};

const MULTIPLY_RANDOM_RECOVERY_FACTORS = {
  none: 0,
  low: 0.02,
  high: 0.04
} as const;

function isSupportedMultiplyRandomRecovery(effect: RecoveryEffectLike): boolean {
  return effect.type === SkillType.Recovery && (effect.valueUsage === 8 || effect.valueUsage === 9);
}

export function isSupportedMultiplyRandomRecoveryDrain(effect: RecoveryEffectLike): boolean {
  return isSupportedMultiplyRandomRecovery(effect) && effect.modifier < 0;
}

function formatRecoveryPercent(modifier: number): string {
  const percent = Math.abs(modifier) * 100;
  const rounded = Number.isInteger(percent) ? percent.toString() : percent.toFixed(2);
  return `${rounded.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1')}%`;
}

export function describeRecoveryEffect(effect: RecoveryEffectLike): string | null {
  if (!isSupportedMultiplyRandomRecovery(effect)) {
    return null;
  }

  const verb = effect.modifier < 0 ? 'drain' : 'recover';

  return [
    `60% chance to ${verb} nothing`,
    `30% to ${verb} ${formatRecoveryPercent(effect.modifier * MULTIPLY_RANDOM_RECOVERY_FACTORS.low)}`,
    `10% to ${verb} ${formatRecoveryPercent(effect.modifier * MULTIPLY_RANDOM_RECOVERY_FACTORS.high)}`
  ].join(', ');
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
