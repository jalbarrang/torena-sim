import { activatedTagCountValueScalingDescriptor } from './activated-tag-count';
import { aoharuTeamStatsValueScalingDescriptor } from './aoharu-team-stats';
import { climaxRacesWonValueScalingDescriptor } from './climax-races-won';
import type {
  ScalingEffectLike,
  ValueScalingDescriptor,
  ValueScalingDisplayContext,
  ValueScalingDisplayModel
} from './descriptor.types';
import { directValueScalingDescriptor } from './direct';
import { multiplyRandomValueScalingDescriptor } from './multiply-random';

const descriptors = [
  directValueScalingDescriptor,
  aoharuTeamStatsValueScalingDescriptor,
  multiplyRandomValueScalingDescriptor,
  activatedTagCountValueScalingDescriptor,
  climaxRacesWonValueScalingDescriptor
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

export function buildValueScalingDisplay(
  effects: ReadonlyArray<ScalingEffectLike>,
  context: ValueScalingDisplayContext
): ReadonlyArray<ValueScalingDisplayModel> {
  const effectsByUsage = new Map<number, Array<ScalingEffectLike>>();

  for (const effect of effects) {
    const usage = effect.valueUsage ?? 1;
    if (!descriptorsByUsage.get(usage)?.buildDisplay) {
      continue;
    }

    const groupedEffects = effectsByUsage.get(usage);
    if (groupedEffects) {
      groupedEffects.push(effect);
    } else {
      effectsByUsage.set(usage, [effect]);
    }
  }

  return Array.from(effectsByUsage, ([usage, groupedEffects]) => {
    const descriptor = descriptorsByUsage.get(usage);
    return descriptor?.buildDisplay?.(groupedEffects, context) ?? null;
  }).filter((model): model is ValueScalingDisplayModel => model !== null);
}
