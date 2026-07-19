import type { ComponentProps, HTMLAttributes, ReactNode } from 'react';
import type { ValueScalingDisplayContext } from '@/lib/uma-domain/skills/value-scaling/descriptor.types';
import type { SkillEntry } from '@/modules/data/services/SkillService';
import type { SkillCostSummary } from '@/modules/skills/skill-cost-summary';
import type { SkillMeta } from './context';

type SkillItemRootSize = 'default' | 'summary';

export type SkillItemIdentityProps = {
  iconId?: string;
  skillId?: string;
  className?: string;
  labelProps?: HTMLAttributes<HTMLSpanElement>;
};

export type SkillItemDetailsActionsProps = {
  dismissable?: boolean;
  onDismiss?: () => void;
  className?: string;
};

export type SkillItemCostActionProps = {
  layout?: 'inline' | 'summary';
  className?: string;
};

export type SkillItemRootProps = HTMLAttributes<HTMLDivElement> & {
  skillId?: string;
  interactive?: boolean;
  selected?: boolean;
  isHovered?: boolean;
  isFocused?: boolean;
  size?: SkillItemRootSize;
};

export type SkillItemRailProps = ComponentProps<'div'> & {
  rarity?: SkillEntry['rarity'];
};

export type SkillItemContextProps = {
  skillId: string;
  valueScalingContext?: ValueScalingDisplayContext;
  distanceFactor?: number;
  spCost?: number;
  costSummary?: SkillCostSummary;
  runnerId?: string;
  hasFastLearner?: boolean;
  onHintLevelChange?: (skillId: string, level: number) => void;
  onBoughtChange?: (skillId: string, bought: boolean) => void;
  onRemove?: (skillId: string) => void;
  getSkillMeta?: (skillId: string) => SkillMeta;
};

export type SkillItemProps = SkillItemContextProps & {
  children: ReactNode;
};
