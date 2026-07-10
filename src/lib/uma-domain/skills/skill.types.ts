import type { Runner } from '../runner/types';
import type { ActivationSamplePolicy } from './policies/ActivationSamplePolicy';
import type { RegionList } from '../shared/region';
import type { ISkillRarity, ISkillTarget, ISkillType } from './definitions';

export type DynamicCondition = (runner: Runner) => boolean;

export type SkillEffect = {
  target: ISkillTarget;
  type: ISkillType;
  baseDuration: number;
  modifier: number;
  valueUsage?: number;
  valueLevelUsage?: number;
};

export type SkillTrigger = {
  skillId: string;
  // for some reason 1*/2* uniques, 1*/2* upgraded to 3*, and naturally 3* uniques all have different rarity (3, 4, 5 respectively)
  rarity: ISkillRarity;
  samplePolicy: ActivationSamplePolicy;
  regions: RegionList;
  effects: Array<SkillEffect>;
  extraCondition: DynamicCondition;
};

type RawSkillEffect = {
  modifier: number;
  target: ISkillTarget;
  type: number;
  valueUsage?: number;
  valueLevelUsage?: number;
};

export type SkillAlternative = {
  baseDuration: number;
  cooldownTime?: number;
  condition: string;
  precondition?: string;
  effects: Array<RawSkillEffect>;
};
