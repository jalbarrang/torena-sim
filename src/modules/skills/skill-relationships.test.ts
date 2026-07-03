import { afterEach, describe, expect, it, vi } from 'vitest';
import { skillsService } from '@/modules/data/services/SkillService';
import {
  getBaseTier,
  getUpgradeTier,
  invalidateSkillFamilyMap,
  isStackableSkill
} from './skill-relationships';

const getSkillIdByName = (name: string): string => {
  const skill = skillsService.getAll().find((entry) => entry.name === name);
  if (!skill) {
    throw new Error(`Could not find skill named "${name}"`);
  }
  return skill.id;
};

afterEach(() => {
  vi.restoreAllMocks();
  invalidateSkillFamilyMap();
});

describe('skill-relationships family map cache', () => {
  it('resolves stackable tiers for a three-white-tier family (Firm Conditions)', () => {
    const baseId = getSkillIdByName('Firm Conditions ○');
    const upgradeId = getSkillIdByName('Firm Conditions ◎');

    expect(isStackableSkill(baseId)).toBe(true);
    expect(isStackableSkill(upgradeId)).toBe(true);
    // × (self-debuff) is filtered out; base is the ○, upgrade is the ◎.
    expect(getBaseTier(upgradeId)).toBe(baseId);
    expect(getUpgradeTier(baseId)).toBe(upgradeId);
  });

  it('does not cache a family map built before the skill dataset is ready', () => {
    const baseId = getSkillIdByName('Firm Conditions ○');
    const upgradeId = getSkillIdByName('Firm Conditions ◎');

    // Force a fresh build and simulate a lookup while the dataset is empty
    // (the pre-bootstrap window). getBaseTier can't see the family, so it
    // returns the input unchanged.
    invalidateSkillFamilyMap();
    const getAllSpy = vi.spyOn(skillsService, 'getAll').mockReturnValue([]);
    expect(getBaseTier(upgradeId)).toBe(upgradeId);
    getAllSpy.mockRestore();

    // Once data is available the empty result must NOT have been memoized:
    // the same lookup now resolves correctly.
    expect(getBaseTier(upgradeId)).toBe(baseId);
  });
});
