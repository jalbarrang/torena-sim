export type ScalingEffectLike = {
  type: number;
  modifier: number;
  valueUsage?: number;
};

export type ValueScalingDisplayContext = {
  activatedGreenCount?: number;
};

type ValueScalingTier = {
  label: string;
  multiplier: number;
};

export type ValueScalingRow = {
  effectType: number;
  base: number;
  multiplier: number;
  result: number;
};

export type ValueScalingDisplayModel = {
  usage: number;
  header: string;
  resolution: 'resolved' | 'fixed' | 'unsupported';
  tiers?: ReadonlyArray<ValueScalingTier>;
  activeTierIndex?: number;
  trailing?: string;
  rows?: ReadonlyArray<ValueScalingRow>;
  notes?: ReadonlyArray<string>;
};

export type ValueScalingDescriptor = {
  usage: ReadonlyArray<number>;
  name: string;
  simulatable: boolean;
  describe: (effect: ScalingEffectLike) => string | null;
  buildDisplay?: (
    effects: ReadonlyArray<ScalingEffectLike>,
    context: ValueScalingDisplayContext
  ) => ValueScalingDisplayModel | null;
};
