/**
 * Skill Optimizer
 *
 * Finds optimal skill combinations within budget constraints.
 *
 * Strategy:
 * 1. Start with obtained skills (baseline, cost=0)
 * 2. Generate combinations from candidate pool
 * 3. Resolve conflicts (gold > white, ◎ > ○)
 * 4. Simulate each combination
 * 5. Rank by performance
 *
 * Uses racer-sim's BatchSimulator for efficient simulation.
 */

import type { IRunnerState } from '../runners/components/runner-card/domain/runner-state';
import type { CandidateSkill, CombinationResult } from './types';
import type { CourseData } from '@/lib/uma-domain/course/definitions';
import type { RaceParameters } from '@/lib/uma-domain/race/types';
import {
  getBaseTier,
  getGoldVersion,
  getUpgradeTier,
  getWhiteVersion
} from '@/modules/skills/skill-relationships';
import { calculateCombinationCost } from './combination-cost';

/**
 * Input parameters for skill optimization
 */
interface OptimizerInput {
  /** Skills already owned from career (cost = 0, always included) */
  obtainedSkills: Array<string>;
  /** Candidate skills available to purchase */
  candidates: Array<CandidateSkill>;
  /** Available skill points budget */
  budget: number;
  /** Runner configuration for simulation */
  runnerConfig: IRunnerState;
  /** Course data */
  course: CourseData;
  /** Race parameters */
  raceParameters: RaceParameters;
  /** Number of simulation runs per combination */
  nsamples?: number;
  /** Callback for progress updates */
  onProgress?: (completed: number, total: number, currentBest: CombinationResult | null) => void;
}

/**
 * Resolve active skills by filtering out superseded skills
 *
 * Resolution rules:
 * 1. Gold supersedes white (same family)
 * 2. Upgrade tier (◎) supersedes base tier (○)
 *
 * @param skillIds List of skill IDs (obtained + candidates)
 * @returns Filtered list with only active skills
 */
export function resolveActiveSkills(skillIds: Array<string>): Array<string> {
  const resolved = new Set(skillIds);

  for (const skillId of skillIds) {
    // Check if there's a gold version in the list
    const goldVersion = getGoldVersion(skillId);
    if (goldVersion && resolved.has(goldVersion)) {
      // Remove white version (gold supersedes)
      resolved.delete(skillId);
      continue;
    }

    // Check if there's an upgrade tier in the list
    const upgradeTier = getUpgradeTier(skillId);
    if (upgradeTier && resolved.has(upgradeTier)) {
      // Remove base tier (upgrade supersedes)
      resolved.delete(skillId);
      continue;
    }
  }

  return Array.from(resolved);
}

const MAX_COMBINATIONS = 500;

/**
 * Generate all skill combinations that fit within budget.
 *
 * Uses recursive enumeration with cost-based pruning: candidates are sorted
 * by cost ascending so we can break early when adding the cheapest remaining
 * candidate would exceed the budget.
 *
 * Capped at MAX_COMBINATIONS to keep simulation time bounded.
 */
export function generateCombinations(
  candidates: Array<CandidateSkill>,
  budget: number
): Array<Array<string>> {
  const combinations: Array<Array<string>> = [[]];
  const sorted = candidates.toSorted((a, b) => a.netCost - b.netCost);

  let capped = false;

  function enumerate(start: number, current: Array<string>, currentCost: number) {
    for (let i = start; i < sorted.length; i++) {
      const newCost = currentCost + sorted[i].netCost;
      if (newCost > budget) break;

      const combo = [...current, sorted[i].skillId];
      combinations.push(combo);

      if (combinations.length >= MAX_COMBINATIONS) {
        capped = true;
        return;
      }

      enumerate(i + 1, combo, newCost);
      if (capped) return;
    }
  }

  enumerate(0, [], 0);

  return enforcePrerequisites(combinations, candidates, budget);
}

/**
 * Enforce prerequisite purchase chains in generated combinations.
 *
 * Purchase chain: base ○ → upgrade ◎ → gold
 *  - Gold requires both white tiers (base ○ and upgrade ◎)
 *  - Upgrade ◎ requires base ○
 *
 * Prerequisites that are already obtained (not in candidate pool) are skipped.
 */
function enforcePrerequisites(
  combinations: Array<Array<string>>,
  candidates: Array<CandidateSkill>,
  budget: number
): Array<Array<string>> {
  const candidateMap = new Map(candidates.map((c) => [c.skillId, c]));

  // Build prerequisite map: skillId → list of required skill IDs
  const prerequisites = new Map<string, Array<string>>();

  for (const candidate of candidates) {
    const prereqs: Array<string> = [];

    if (candidate.isGold) {
      // Gold → needs base ○ and upgrade ◎
      const whiteId = getWhiteVersion(candidate.skillId);
      if (whiteId) {
        const baseId = getBaseTier(whiteId);
        const upgradeId = getUpgradeTier(baseId);
        if (baseId && candidateMap.has(baseId)) prereqs.push(baseId);
        if (upgradeId && candidateMap.has(upgradeId)) prereqs.push(upgradeId);
      }
    } else // Upgrade ◎ → needs base ○
    if (
      candidate.isStackable &&
      candidate.tierLevel === 2 &&
      candidate.previousTierId &&
      candidateMap.has(candidate.previousTierId)
    ) {
      prereqs.push(candidate.previousTierId);
    }

    if (prereqs.length > 0) {
      prerequisites.set(candidate.skillId, prereqs);
    }
  }

  if (prerequisites.size === 0) {
    return combinations;
  }

  const uniqueKeys = new Set<string>();
  const filtered: Array<Array<string>> = [];

  for (const combination of combinations) {
    const withPrerequisites = new Set(combination);

    for (const skillId of combination) {
      const prereqs = prerequisites.get(skillId);
      if (prereqs) {
        for (const prereqId of prereqs) {
          withPrerequisites.add(prereqId);
        }
      }
    }

    const normalized = Array.from(withPrerequisites);
    const key = normalized.toSorted().join(',');

    if (uniqueKeys.has(key)) continue;

    const cost = calculateCombinationCost(normalized, candidates);
    if (cost > budget) continue;

    uniqueKeys.add(key);
    filtered.push(normalized);
  }

  return filtered;
}

/**
 * Calculate total cost of a skill combination
 */
// Re-exported from the data-free module so existing importers keep working while
// worker-side code can import it without pulling in `skill-relationships`.
export { calculateCombinationCost };
