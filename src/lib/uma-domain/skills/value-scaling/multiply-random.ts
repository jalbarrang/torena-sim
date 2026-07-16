import { SkillType } from '../definitions';
import type { ScalingEffectLike, ValueScalingDescriptor } from './descriptor.types';

export const MULTIPLY_RANDOM_RECOVERY_FACTORS = {
  none: 0,
  low: 0.02,
  high: 0.04
} as const;

function isMultiplyRandomRecovery(effect: ScalingEffectLike): boolean {
  return effect.type === SkillType.Recovery && (effect.valueUsage === 8 || effect.valueUsage === 9);
}

function formatRecoveryPercent(modifier: number): string {
  const percent = Math.abs(modifier) * 100;
  const rounded = Number.isInteger(percent) ? percent.toString() : percent.toFixed(2);
  return `${rounded.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1')}%`;
}

export function describeRecoveryEffect(effect: ScalingEffectLike): string | null {
  if (!isMultiplyRandomRecovery(effect)) {
    return null;
  }

  const verb = effect.modifier < 0 ? 'drain' : 'recover';
  return [
    `60% chance to ${verb} nothing`,
    `30% to ${verb} ${formatRecoveryPercent(effect.modifier * MULTIPLY_RANDOM_RECOVERY_FACTORS.low)}`,
    `10% to ${verb} ${formatRecoveryPercent(effect.modifier * MULTIPLY_RANDOM_RECOVERY_FACTORS.high)}`
  ].join(', ');
}

export const multiplyRandomValueScalingDescriptor: ValueScalingDescriptor = Object.freeze({
  usage: [8, 9],
  name: 'MultiplyRandom',
  simulatable: true,
  describe: describeRecoveryEffect
});
