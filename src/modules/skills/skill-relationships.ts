/**
 * Skill Relationship Parser
 *
 * Parses the `versions` field from GameTora skills data to build skill family maps.
 * Supports detection of:
 * - Stackable skills (○/◎ tiers)
 * - Gold/White skill relationships
 * - Tier ordering based on cost
 *
 * ## Skill Family Patterns
 *
 * Skills in the same family are grouped by consecutive IDs. The position in the sequence
 * determines the skill type. Debuffs (×) have negative effects and are filtered out when
 * identifying stackable skills.
 *
 * ### Pattern 1: Three White + One Gold (4 skills)
 * Position: Upgrade (◎), Base (○), SelfDebuff (×), Gold
 * - Example: `200011-14` → Right-Handed ◎, Right-Handed ○, Right-Handed ×, Right-Handed Demon
 * - Stackable: Yes (has both ◎ and ○ with positive effects)
 *
 * ### Pattern 2: Three White Only (3 skills)
 * Position: Upgrade (◎), Base (○), SelfDebuff (×)
 * - Example: `200281-83` → Competitive Spirit ◎, Competitive Spirit ○, Wallflower
 * - Stackable: Yes (has both ◎ and ○ with positive effects)
 *
 * ### Pattern 3a: Two White + One Gold (3 skills, Upgrade variant)
 * Position: Upgrade (◎), Base (○), Gold
 * - Example: `201111-13` → Medium Corners ◎, Medium Corners ○, Refraction Arc
 * - Stackable: Yes (has both ◎ and ○ with positive effects)
 *
 * ### Pattern 3b: Two White + One Gold (3 skills, Debuff variant)
 * Position: Gold, Base (○), SelfDebuff (×)
 * - Example: `200331-33` → Professor of Curvature, Corner Adept ○, Corner Adept ×
 * - Stackable: No (only has ○, no ◎ upgrade)
 *
 * ## Skill ID Format
 *
 * Most skills follow a structured ID format:
 * - `|20|033|1|` → Category (20) | SkillID (033) | Variant (1)
 * - `|91|0041|` → Category (91) | SkillID (0041) (no variant for some categories)
 *
 * The variant digit typically indicates:
 * - 1 = Upgrade (◎) or Gold
 * - 2 = Base (○)
 * - 3 = SelfDebuff (×) or Gold (in Pattern 3b)
 * - 4 = Gold (in Pattern 1)
 */

import { skillsService } from '@/modules/data/services/SkillService';
import { SkillTarget } from '@/lib/uma-domain/skills/definitions';
import type { SkillEntry } from '@/modules/data/services/SkillService';

// ============================================================================
// Internal Data Structures
// ============================================================================

/**
 * Map of skill ID to all family member IDs (including self), built lazily on
 * first use. Lazy (not module-load) so it doesn't read `skillsService` before
 * the async data bootstrap has populated it.
 */
let skillFamilyMapCache: Map<string, Array<string>> | null = null;

function getSkillFamilyMap(): Map<string, Array<string>> {
  if (skillFamilyMapCache) {
    return skillFamilyMapCache;
  }

  const skills = skillsService?.getAll() ?? [];
  const map = new Map<string, Array<string>>();
  for (const skill of skills) {
    if (skill.versions && skill.versions.length > 0) {
      map.set(skill.id, [skill.id, ...skill.versions.map(String)]);
    }
  }

  // Do NOT cache a map built before the skill dataset finished bootstrapping.
  // A lazily-built empty/partial map would otherwise be memoized permanently
  // and degrade every family/tier lookup for the rest of the session.
  if (skills.length === 0) {
    return map;
  }

  skillFamilyMapCache = map;
  return skillFamilyMapCache;
}

/**
 * Clear the memoized family map. Exposed for tests and for any future call site
 * that reloads the skill dataset at runtime.
 */
export function invalidateSkillFamilyMap(): void {
  skillFamilyMapCache = null;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a skill has positive effects (not a debuff)
 */
function hasPositiveEffects(skill: SkillEntry): boolean {
  if (!skill.alternatives || skill.alternatives.length === 0) {
    return false;
  }

  // Check if any effect has a positive value
  for (const group of skill.alternatives) {
    for (const effect of group.effects) {
      // Positive value means buff, negative means debuff
      if (effect.modifier > 0) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check whether a skill has any positive effect values.
 * Useful for identifying self-debuff skills even when icon metadata is inconsistent.
 */
function hasPositiveSkillEffects(skillId: string): boolean {
  const skill = skillsService.getById(skillId);

  if (!skill) {
    return false;
  }

  return hasPositiveEffects(skill);
}

/**
 * Skill has at least one effect on self with a negative modifier (true self-debuff).
 */
export function isSelfDebuffSkill(skill: SkillEntry): boolean {
  return skill.alternatives.some((alternative) =>
    alternative.effects.some((effect) => effect.target === SkillTarget.Self && effect.modifier < 0)
  );
}

export function isSelfDebuffSkillById(skillId: string): boolean {
  const skill = skillsService.getById(skillId);
  if (!skill) return false;
  return isSelfDebuffSkill(skill);
}

/**
 * Get all white (rarity=1) skills from a family, excluding self-debuff (×) variants.
 *
 * Membership is gated on “not a self-debuff” rather than “has a positive modifier”:
 * opponent/FOV debuffs (e.g. Intense/Petrifying Gaze) carry *negative* modifiers
 * aimed at other runners but are still real, ownable family members — only the
 * self-targeted × downgrade skills should be filtered out.
 */
function getWhiteSkillsInFamily(familyIds: Array<string>): Array<SkillEntry> {
  const whiteSkills: Array<SkillEntry> = [];

  for (const id of familyIds) {
    const skill = skillsService.getById(id);
    if (skill && skill.rarity === 1 && !isSelfDebuffSkill(skill)) {
      whiteSkills.push(skill);
    }
  }

  return whiteSkills;
}

/**
 * Get gold (rarity=2) skill from a family
 */
function getGoldSkillInFamily(familyIds: Array<string>): SkillEntry | undefined {
  for (const id of familyIds) {
    const skill = skillsService.getById(id);
    if (skill && skill.rarity === 2) {
      return skill;
    }
  }
  return undefined;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Get all skill IDs in the same family as the given skill.
 * Includes the skill itself.
 *
 * @param skillId - The skill ID to look up
 * @returns Array of all related skill IDs (as strings)
 *
 * @example
 * getSkillFamily("200011") // returns ["200011", "200012", "200013", "200014"]
 */
function getSkillFamily(skillId: string): Array<string> {
  const family = getSkillFamilyMap().get(skillId);

  if (!family) {
    // Skill not found - return just the ID itself
    return [skillId];
  }

  return family.map((id) => id.toString());
}

/**
 * Check if a skill is stackable (has base and upgrade tiers).
 * A skill is stackable if:
 * - It has rarity=1 (white)
 * - It has positive effects (not a debuff)
 * - Its family contains 2+ white skills with positive effects
 *
 * @param skillId - The skill ID to check
 * @returns true if the skill is stackable
 *
 * @example
 * isStackableSkill("200011") // true (Right-Handed ◎ has upgrade and base)
 * isStackableSkill("200012") // true (Right-Handed ○ has upgrade and base)
 * isStackableSkill("200013") // false (Right-Handed × is a debuff)
 * isStackableSkill("200332") // false (Corner Adept ○ has no ◎ version)
 */
export function isStackableSkill(skillId: string): boolean {
  const skill = skillsService.getById(skillId);

  if (!skill || skill.rarity !== 1) {
    return false;
  }

  // Self-debuff (×) skills themselves are not stackable
  if (isSelfDebuffSkill(skill)) {
    return false;
  }

  const family = getSkillFamilyMap().get(skillId);
  if (!family) {
    return false;
  }

  const whiteSkills = getWhiteSkillsInFamily(family);

  // Need at least 2 white skills (base and upgrade) to be stackable
  return whiteSkills.length >= 2;
}

/**
 * Get the gold (rarity=2) version of a white skill, if it exists.
 *
 * @param whiteSkillId - The white skill ID
 * @returns The gold skill ID, or undefined if no gold version exists
 *
 * @example
 * getGoldVersion("200332") // "200331" (gold version of Corner Adept)
 */
export function getGoldVersion(whiteSkillId: string): string | undefined {
  const skill = skillsService.getById(whiteSkillId);

  if (!skill || skill.rarity !== 1) {
    return undefined;
  }

  const family = getSkillFamilyMap().get(whiteSkillId);
  if (!family) {
    return undefined;
  }

  const goldSkill = getGoldSkillInFamily(family);
  return goldSkill ? goldSkill.id.toString() : undefined;
}

/**
 * Get the white (rarity=1) version(s) of a gold skill.
 * Returns the base tier white skill.
 *
 * @param goldSkillId - The gold skill ID
 * @returns The base tier white skill ID, or undefined if no white version exists
 *
 * @example
 * getWhiteVersion("200331") // "200332" (white ○ version of Archline Professor)
 */
export function getWhiteVersion(goldSkillId: string): string | undefined {
  const skill = skillsService.getById(goldSkillId);

  if (!skill || skill.rarity !== 2) {
    return undefined;
  }

  const family = getSkillFamilyMap().get(goldSkillId);
  if (!family) {
    return undefined;
  }

  const whiteSkills = getWhiteSkillsInFamily(family);

  if (whiteSkills.length === 0) {
    return undefined;
  }

  // Return the base tier (lowest cost)
  let baseTier = whiteSkills[0];
  let lowestCost = baseTier?.baseCost ?? Infinity;

  for (let i = 1; i < whiteSkills.length; i += 1) {
    const skill = whiteSkills[i]!;
    const cost = skill.baseCost ?? Infinity;
    if (cost < lowestCost) {
      baseTier = skill;
      lowestCost = cost;
    }
  }

  return baseTier ? baseTier.id.toString() : undefined;
}

/**
 * Get the base tier (○) of a stackable skill.
 * If the skill is not stackable, returns the skill itself.
 *
 * @param skillId - The skill ID
 * @returns The base tier skill ID
 *
 * @example
 * getBaseTier("200332") // "200332" (already base tier)
 * getBaseTier("200333") // "200332" (base tier of the upgrade)
 */
export function getBaseTier(skillId: string): string {
  const skill = skillsService.getById(skillId);

  if (!skill || skill.rarity !== 1) {
    return skillId;
  }

  const family = getSkillFamilyMap().get(skillId);
  if (!family) {
    return skillId;
  }

  const whiteSkills = getWhiteSkillsInFamily(family);

  if (whiteSkills.length < 2) {
    // Not stackable
    return skillId;
  }

  // Sort by cost ascending - lowest cost is base tier
  const sorted = whiteSkills.sort((a, b) => {
    const costA = a.baseCost ?? Infinity;
    const costB = b.baseCost ?? Infinity;
    return costA - costB;
  });

  return sorted[0].id.toString();
}

/**
 * Get the upgrade tier (◎) of a stackable skill, if it exists.
 *
 * @param skillId - The skill ID (should be base tier)
 * @returns The upgrade tier skill ID, or undefined if no upgrade exists
 *
 * @example
 * getUpgradeTier("200332") // "200333" (upgrade tier exists)
 * getUpgradeTier("200011") // undefined (no upgrade tier)
 */
export function getUpgradeTier(skillId: string): string | undefined {
  const skill = skillsService.getById(skillId);

  if (!skill || skill.rarity !== 1) {
    return undefined;
  }

  const family = getSkillFamilyMap().get(skillId);
  if (!family) {
    return undefined;
  }

  const whiteSkills = getWhiteSkillsInFamily(family);

  // Sort by ID (Lowest is upgrade, highest is base / debuff)
  const sorted = whiteSkills.toSorted((a, b) => skillsService.skillComparator(a.id, b.id));

  // Find current skill in sorted list
  const currentIndex = sorted.findIndex((s) => s.id === skillId);

  if (currentIndex === -1) {
    // Skill not found or already at highest tier
    return undefined;
  }

  const nextTier = sorted[currentIndex - 1] ?? undefined;

  if (!nextTier) {
    return undefined;
  }

  // Return next tier
  return nextTier.id.toString();
}
