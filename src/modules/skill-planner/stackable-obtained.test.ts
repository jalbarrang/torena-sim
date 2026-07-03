import { beforeEach, describe, expect, it } from 'vitest';
import { skillsService } from '@/modules/data/services/SkillService';
import { isSkillCoveredByOwnedFamily } from './skill-family';
import { generateCombinations, resolveActiveSkills } from './optimizer';
import {
  createCandidate,
  getObtainedSkills,
  getSkillPlanningMeta,
  setObtainedSkills,
  startOver
} from './skill-planner.store';

const getSkillIdByName = (name: string): string => {
  const skill = skillsService.getAll().find((entry) => entry.name === name);
  if (!skill) {
    throw new Error(`Could not find skill named "${name}"`);
  }
  return skill.id;
};

const firmBaseId = () => getSkillIdByName('Firm Conditions ○');
const firmUpgradeId = () => getSkillIdByName('Firm Conditions ◎');

describe('stackable obtained handling (Firm Conditions family)', () => {
  it('owning ◎ covers ○, but owning ○ does not cover ◎', () => {
    const baseId = firmBaseId();
    const upgradeId = firmUpgradeId();

    expect(isSkillCoveredByOwnedFamily(baseId, [baseId])).toBe(true);
    expect(isSkillCoveredByOwnedFamily(baseId, [upgradeId])).toBe(true);
    expect(isSkillCoveredByOwnedFamily(upgradeId, [baseId])).toBe(false);
  });

  it('main-thread candidate filter drops an obtained ○ but keeps the ◎ purchasable', () => {
    const baseId = firmBaseId();
    const upgradeId = firmUpgradeId();
    const obtained = [baseId];

    const candidates = [createCandidate({ skillId: baseId }), createCandidate({ skillId: upgradeId })];

    // Mirrors the filter in useSkillPlannerOptimizer (family-aware, not id equality).
    const filtered = candidates.filter(
      (candidate) => !isSkillCoveredByOwnedFamily(candidate.skillId, obtained)
    );

    expect(filtered.map((candidate) => candidate.skillId)).toEqual([upgradeId]);
  });

  it('does not re-add an obtained ○ prereq when only the ◎ is a candidate', () => {
    const baseId = firmBaseId();
    const upgradeId = firmUpgradeId();

    // ○ is obtained (not in the candidate pool), so combinations for the ◎
    // candidate must never include buying ○ again.
    const combinations = generateCombinations([createCandidate({ skillId: upgradeId })], 9999);

    for (const combination of combinations) {
      expect(combination).not.toContain(baseId);
    }
  });

  it('resolveActiveSkills drops an obtained ○ once the ◎ is added on top', () => {
    const baseId = firmBaseId();
    const upgradeId = firmUpgradeId();

    const active = resolveActiveSkills([baseId, upgradeId]);
    expect(active).toContain(upgradeId);
    expect(active).not.toContain(baseId);
  });

  it('marking ○ obtained reports it as bought (and does not mark the ◎)', () => {
    startOver();
    const baseId = firmBaseId();
    const upgradeId = firmUpgradeId();

    setObtainedSkills([baseId]);

    expect(getObtainedSkills()).toContain(baseId);
    expect(getSkillPlanningMeta(baseId).bought).toBe(true);
    expect(getSkillPlanningMeta(upgradeId).bought).toBe(false);
  });
});

beforeEach(() => {
  startOver();
});
