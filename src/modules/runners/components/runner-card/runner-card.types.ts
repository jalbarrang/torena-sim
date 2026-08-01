import type { ValueScalingDisplayContext } from '@/lib/uma-domain/skills/value-scaling/descriptor.types';

import type { IRunnerState } from './domain/runner-state';

export type RunnerCardStatKey = keyof Pick<
  IRunnerState,
  'speed' | 'stamina' | 'power' | 'guts' | 'wisdom'
>;

export type RunnerCardProps = {
  value: IRunnerState;
  courseDistance?: number;
  runnerId: string;
  valueScalingContext?: ValueScalingDisplayContext;
  onChange: (value: IRunnerState) => void;
  onReset?: () => void;
  onCopy?: () => void;
  onSwap?: () => void;
  onOpenSkillPicker?: () => void;
  hideSkillButton?: boolean;
  showSkillSpCosts?: boolean;
  showShareButton?: boolean;
  courseId?: number;
  showStrategyMood?: boolean;
  /** Bare keyboard shortcut (e.g. "k") to open the skill picker. Desktop only. */
  skillHotkey?: string;
};
