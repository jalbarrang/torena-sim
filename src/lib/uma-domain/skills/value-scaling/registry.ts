import { activatedTagCountValueScalingDescriptor } from './activated-tag-count';
import type { ScalingEffectLike, ValueScalingDescriptor } from './descriptor.types';
import { directValueScalingDescriptor } from './direct';
import { multiplyRandomValueScalingDescriptor } from './multiply-random';

const descriptors = [
  directValueScalingDescriptor,
  multiplyRandomValueScalingDescriptor,
  activatedTagCountValueScalingDescriptor
] as const;

const descriptorsByUsage = new Map<number, ValueScalingDescriptor>(
  descriptors.flatMap((descriptor) => descriptor.usage.map((usage) => [usage, descriptor] as const))
);

export const supportedSimulatableValueUsages: ReadonlySet<number> = new Set(
  descriptors
    .filter((descriptor) => descriptor.simulatable)
    .flatMap((descriptor) => descriptor.usage)
);

export function describeValueScaling(effect: ScalingEffectLike): string | null {
  const usage = effect.valueUsage ?? 1;
  const descriptor = descriptorsByUsage.get(usage);

  return descriptor
    ? descriptor.describe(effect)
    : `Special scaling (usage ${usage}) — not yet simulated`;
}
