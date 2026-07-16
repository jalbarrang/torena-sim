export type ScalingEffectLike = {
  type: number;
  modifier: number;
  valueUsage?: number;
};

export type ValueScalingDisplayContext = {
  activatedGreenCount?: number;
};

export type ValueScalingDescriptor = {
  usage: ReadonlyArray<number>;
  name: string;
  simulatable: boolean;
  describe: (effect: ScalingEffectLike) => string | null;
  resolveDisplay?: (
    effect: ScalingEffectLike,
    context: ValueScalingDisplayContext
  ) => string | null;
};
