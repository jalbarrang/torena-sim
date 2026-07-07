import type { CandidateSkill, CostBreakdown, HintLevel } from './types';
import { skillsService } from '@/modules/data/services/SkillService';
import { getBaseTier, getUpgradeTier } from '@/modules/skills/skill-relationships';
import { isSkillCoveredByOwnedFamily } from './skill-family';
import { HINT_DISCOUNTS } from './hint-levels';

/**
 * Calculate the raw discounted cost of a skill before integer rounding.
 * Cost formula: baseCost * (1 - hintDiscount) * (hasFastLearner ? 0.9 : 1)
 */
export function calculateRawSkillCost(
  skillId: string,
  hintLevel: HintLevel,
  hasFastLearner: boolean
): number {
  const skill = skillsService.getById(skillId);
  if (!skill) {
    throw new Error(`Skill not found: ${skillId}`);
  }
  const baseCost = skill.baseCost;

  const hintDiscount = HINT_DISCOUNTS[hintLevel] ?? 0;
  const fastLearnerMultiplier = hasFastLearner ? 0.9 : 1.0;

  return baseCost * (1 - hintDiscount) * fastLearnerMultiplier;
}

/**
 * Calculate the effective cost of a skill with all discounts applied.
 */
export function calculateSkillCost(
  skillId: string,
  hintLevel: HintLevel,
  hasFastLearner: boolean
): number {
  // Apply hint discount first, then Fast Learner, then ceil the result.
  return Math.ceil(calculateRawSkillCost(skillId, hintLevel, hasFastLearner));
}

/**
 * Compute discounted net cost for a candidate.
 */
export function getNetCost(candidate: CandidateSkill, hasFastLearner: boolean): number {
  return calculateSkillCost(candidate.skillId, candidate.hintLevel, hasFastLearner);
}

/**
 * Get the base cost of a skill without any discounts
 */
function getBaseCost(skillId: string): number {
  const skill = skillsService.getById(skillId);
  if (!skill) {
    throw new Error(`Skill not found: ${skillId}`);
  }
  return skill.baseCost;
}

/**
 * Calculate the display cost for a skill, handling bundled costs for gold skills.
 *
 * For gold skills, the display cost depends on whether the white prerequisite skill
 * is already obtained:
 * - If white skill is obtained: show only the gold skill cost
 * - If white skill is not obtained: show bundled cost (white + gold)
 *
 * For white skills, returns the effective cost directly.
 *
 * @param skillId - The skill ID to calculate display cost for
 * @param candidates - Map of all candidate skills with their metadata
 * @param obtainedSkills - Array of skill IDs that are already obtained
 * @param hasFastLearner - Whether Fast Learner discount applies
 * @returns The display cost with all applicable discounts
 */
export function calculateDisplayCost(
  skillId: string,
  candidates: Record<string, CandidateSkill>,
  obtainedSkills: Array<string>,
  hasFastLearner: boolean
): number {
  const candidate = candidates[skillId];

  if (!candidate) {
    throw new Error(`Candidate not found for skill ID: ${skillId}`);
  }

  // If candidate is not a gold skill, return effective cost
  if (!candidate.isGold) {
    return getNetCost(candidate, hasFastLearner);
  }

  // For gold skills, check if white skill is already obtained
  const whiteSkillId = candidate.whiteSkillId;

  if (!whiteSkillId) {
    throw new Error(`White skill not found for gold skill ID: ${skillId}`);
  }

  // If the white family is already covered, return only gold cost.
  if (isSkillCoveredByOwnedFamily(whiteSkillId, obtainedSkills)) {
    return getNetCost(candidate, hasFastLearner);
  }

  // White skill not obtained - calculate bundled cost (includes ALL white tiers)
  const goldBaseCost = getBaseCost(skillId);
  let bundledWhiteCost = 0;

  // Add white base tier (○) cost
  const whiteBaseTier = getBaseTier(whiteSkillId);
  if (whiteBaseTier) {
    const whiteBaseCost = getBaseCost(whiteBaseTier);
    const whiteBaseCandidate = candidates[whiteBaseTier];
    const whiteBaseHintLevel = whiteBaseCandidate?.hintLevel ?? 0;
    const whiteBaseHintDiscount = HINT_DISCOUNTS[whiteBaseHintLevel] ?? 0;
    bundledWhiteCost += whiteBaseCost * (1 - whiteBaseHintDiscount);
  }

  // Add white upgrade tier (◎) cost if it exists
  const whiteUpgradeTier = getUpgradeTier(whiteBaseTier || whiteSkillId);
  if (whiteUpgradeTier) {
    const whiteUpgradeCost = getBaseCost(whiteUpgradeTier);
    const whiteUpgradeCandidate = candidates[whiteUpgradeTier];
    const whiteUpgradeHintLevel = whiteUpgradeCandidate?.hintLevel ?? 0;
    const whiteUpgradeHintDiscount = HINT_DISCOUNTS[whiteUpgradeHintLevel] ?? 0;
    bundledWhiteCost += whiteUpgradeCost * (1 - whiteUpgradeHintDiscount);
  }

  // Apply hint discount to gold cost
  const goldHintLevel = candidate.hintLevel;
  const goldHintDiscount = HINT_DISCOUNTS[goldHintLevel] ?? 0;
  const goldCostAfterHint = goldBaseCost * (1 - goldHintDiscount);

  // Sum all costs, then apply Fast Learner discount
  const fastLearnerMultiplier = hasFastLearner ? 0.9 : 1.0;
  const bundledCost = (goldCostAfterHint + bundledWhiteCost) * fastLearnerMultiplier;

  return Math.ceil(bundledCost);
}

/**
 * Calculate the total cost for a pool of candidate skills with detailed breakdown.
 *
 * This function is designed for the decoupled model where skills are split into:
 * - obtainedSkills: baseline skills already owned (cost = 0)
 * - candidates: pool of skills available for purchase
 *
 * Cost Calculation Rules:
 * - Obtained skills: cost = 0 (already owned)
 * - Candidate skills: base cost with hint level discount + Fast Learner discount
 * - Gold skill bundling:
 *   - If white skill is in obtainedSkills → gold cost only
 *   - If white skill is NOT in obtainedSkills → bundled cost (white + gold)
 *   - White being in candidates pool does NOT reduce gold cost (they're separate purchases)
 * - Stackable skills: each tier has its own cost, no bundling between base and upgrade
 *
 * @param candidates - Map of candidate skills available for purchase
 * @param obtainedSkills - Array of skill IDs already obtained (baseline)
 * @param hasFastLearner - Whether Fast Learner discount applies
 * @returns Object with total cost and detailed breakdown per skill
 */
function calculatePoolCost(
  candidates: Record<string, CandidateSkill>,
  obtainedSkills: Array<string>,
  hasFastLearner: boolean
): { total: number; breakdown: Array<CostBreakdown> } {
  const breakdown: Array<CostBreakdown> = [];
  let total = 0;

  // Convert obtainedSkills to Set for faster lookup
  const obtainedSet = new Set(obtainedSkills);

  for (const [skillId, candidate] of Object.entries(candidates)) {
    // Skip if skill is already obtained (cost = 0)
    if (obtainedSet.has(skillId)) {
      continue;
    }

    const baseCost = getBaseCost(skillId);
    const hintDiscount = HINT_DISCOUNTS[candidate.hintLevel] ?? 0;
    const fastLearnerMultiplier = hasFastLearner ? 0.9 : 1.0;

    let finalCost: number;
    let bundledWhiteCost: number | undefined;

    // Handle gold skill bundling
    if (candidate.isGold && candidate.whiteSkillId) {
      const whiteSkillId = candidate.whiteSkillId;

      const whiteBaseTier = getBaseTier(whiteSkillId);
      const whiteUpgradeTier = getUpgradeTier(whiteBaseTier || whiteSkillId);
      const hasAnyWhiteTier = isSkillCoveredByOwnedFamily(whiteSkillId, obtainedSet);

      if (hasAnyWhiteTier) {
        // Gold cost only (white already owned)
        const goldCostAfterHint = baseCost * (1 - hintDiscount);
        finalCost = Math.ceil(goldCostAfterHint * fastLearnerMultiplier);
      } else {
        // White not obtained - calculate bundled cost (ALL white tiers)
        let bundledWhite = 0;

        // Add base tier cost
        if (whiteBaseTier) {
          const whiteBaseCost = getBaseCost(whiteBaseTier);
          const whiteBaseCandidate = candidates[whiteBaseTier];
          const whiteBaseHintLevel = whiteBaseCandidate?.hintLevel ?? 0;
          const whiteBaseHintDiscount = HINT_DISCOUNTS[whiteBaseHintLevel] ?? 0;
          bundledWhite += whiteBaseCost * (1 - whiteBaseHintDiscount);
        }

        // Add upgrade tier cost if exists
        if (whiteUpgradeTier) {
          const whiteUpgradeCost = getBaseCost(whiteUpgradeTier);
          const whiteUpgradeCandidate = candidates[whiteUpgradeTier];
          const whiteUpgradeHintLevel = whiteUpgradeCandidate?.hintLevel ?? 0;
          const whiteUpgradeHintDiscount = HINT_DISCOUNTS[whiteUpgradeHintLevel] ?? 0;
          bundledWhite += whiteUpgradeCost * (1 - whiteUpgradeHintDiscount);
        }

        const goldCostAfterHint = baseCost * (1 - hintDiscount);

        bundledWhiteCost = Math.ceil(bundledWhite * fastLearnerMultiplier);
        finalCost = Math.ceil((goldCostAfterHint + bundledWhite) * fastLearnerMultiplier);
      }
    } else {
      // Regular skill (white or non-gold) or stackable skill
      const costAfterHint = baseCost * (1 - hintDiscount);
      finalCost = Math.ceil(costAfterHint * fastLearnerMultiplier);
    }

    breakdown.push({
      skillId,
      baseCost,
      hintDiscount,
      bundledWhiteCost,
      finalCost
    });

    total += finalCost;
  }

  return { total, breakdown };
}
