/**
 * # Skill Planner Comparison — shared settings + result shapes
 *
 * Pure, engine-agnostic settings builder and result types for the planner's
 * paired comparison. Consumed by the live WASM path (`wasm-skill-planner.ts`).
 */
import { createCompareSettings } from './shared';

export function createPlannerCompareSettings(
  ignoreStaminaConsumption: boolean,
  staminaDrainOverrides: Record<string, number> | undefined
) {
  return createCompareSettings({
    healthSystem: !ignoreStaminaConsumption,
    staminaDrainOverrides: ignoreStaminaConsumption ? {} : staminaDrainOverrides
  });
}
