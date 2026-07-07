import type { HintLevel } from './types';

/**
 * Single source of truth for the hint-level → SP discount mapping
 * (as shown in game). Data-free on purpose: UI components and worker-side
 * code can import this without dragging in the skill dataset.
 */
export const HINT_DISCOUNTS: Readonly<Record<HintLevel, number>> = {
  0: 0, // No hint
  1: 0.1, // 10% off (Hint Lvl 1)
  2: 0.2, // 20% off (Hint Lvl 2)
  3: 0.3, // 30% off (Hint Lvl 3)
  4: 0.35, // 35% off (Hint Lvl 4)
  5: 0.4 // 40% off (Hint Lvl 5 - max)
};

export const HINT_LEVELS: ReadonlyArray<HintLevel> = [0, 1, 2, 3, 4, 5];

export const MIN_HINT_LEVEL: HintLevel = 0;
export const MAX_HINT_LEVEL: HintLevel = 5;

/** Discount as a whole percentage (0, 10, 20, 30, 35, 40). */
export function getHintDiscountPercent(level: HintLevel): number {
  return Math.round((HINT_DISCOUNTS[level] ?? 0) * 100);
}
