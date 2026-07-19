import { createContext, useContext } from 'react';
import type { ValueScalingDisplayContext } from '@/lib/uma-domain/skills/value-scaling/descriptor.types';
import type { SkillEntry } from '@/modules/data/services/SkillService';
import type { SkillCostSummary } from '@/modules/skills/skill-cost-summary';

export type SkillMeta = {
  hintLevel: number;
  bought?: boolean;
};

const DEFAULT_SKILL_META: SkillMeta = { hintLevel: 0 };

export const defaultGetSkillMeta = (): SkillMeta => DEFAULT_SKILL_META;

export type SkillItemContextValue = {
  skill: SkillEntry;
  skillId: string;
  normalizedSkillId: string;
  valueScalingContext?: ValueScalingDisplayContext;
  hasFastLearner: boolean;
  hasCost: boolean;
  runnerId?: string;
  distanceFactor?: number;
  spCost?: number;
  costSummary?: SkillCostSummary;
  onHintLevelChange?: (skillId: string, level: number) => void;
  onBoughtChange?: (skillId: string, bought: boolean) => void;
  onRemove?: (skillId: string) => void;
  getSkillMeta: (skillId: string) => SkillMeta;
};

type ISkillItemContext = SkillItemContextValue;

export const SkillItemContext = createContext<SkillItemContextValue | null>(null);

export const useSkillItem = () => {
  const context = useContext(SkillItemContext);

  if (!context) {
    throw new Error('useSkillItem must be used within a SkillItem or SkillItemProvider');
  }

  return context;
};
