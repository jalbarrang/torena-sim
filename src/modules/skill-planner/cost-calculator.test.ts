import { describe, expect, it } from 'vitest';
import { calculateDisplayCost, calculateSkillCost, getNetCost } from './cost-calculator';
import type { CandidateSkill } from './types';
import { skillsService } from '@/modules/data/services/SkillService';
import { runawaySkillId } from '@/modules/runners/components/runner-card/domain/runaway-policy';
import { getWhiteVersion } from '@/modules/skills/skill-relationships';

const getSkillIdByName = (name: string): string => {
  const allSkills = skillsService.getAll();
  const skill = allSkills.find((skill) => skill.name === name);

  if (!skill) {
    throw new Error(`Could not find skill named "${name}"`);
  }

  return skill.id;
};

describe('cost-calculator', () => {
  const skillId = runawaySkillId;
  const baseCost = skillsService.getById(skillId)?.baseCost ?? 0;
  const speedStarId = '200581';
  const preparedToPassId = '200582';

  it('applies hint discount levels from 0 to 5', () => {
    expect(calculateSkillCost(skillId, 0, false)).toBe(baseCost);
    expect(calculateSkillCost(skillId, 1, false)).toBe(Math.ceil(baseCost * 0.9));
    expect(calculateSkillCost(skillId, 2, false)).toBe(Math.ceil(baseCost * 0.8));
    expect(calculateSkillCost(skillId, 3, false)).toBe(Math.ceil(baseCost * 0.7));
    expect(calculateSkillCost(skillId, 4, false)).toBe(Math.ceil(baseCost * 0.65));
    expect(calculateSkillCost(skillId, 5, false)).toBe(Math.ceil(baseCost * 0.6));
  });

  it('applies Fast Learner discount when no hint exists', () => {
    expect(calculateSkillCost(skillId, 0, true)).toBe(Math.ceil(baseCost * 0.9));
  });

  it('stacks hint and Fast Learner discounts in order', () => {
    expect(calculateSkillCost(skillId, 5, true)).toBe(Math.ceil(baseCost * 0.6 * 0.9));
    expect(calculateSkillCost(skillId, 3, true)).toBe(Math.ceil(baseCost * 0.7 * 0.9));
  });

  it('does not undercount floating-point exact integer discounts', () => {
    expect(skillsService.getById(speedStarId)?.baseCost).toBe(180);
    expect(calculateSkillCost(speedStarId, 3, false)).toBe(126);
    expect(calculateSkillCost(preparedToPassId, 2, false)).toBe(144);
  });

  it('getNetCost computes discounted cost from candidate data', () => {
    const candidate: CandidateSkill = {
      skillId,
      cost: baseCost,
      netCost: baseCost,
      hintLevel: 5,
      isStackable: false,
      isGold: false
    };

    expect(getNetCost(candidate, false)).toBe(Math.ceil(baseCost * 0.6));
    expect(getNetCost(candidate, true)).toBe(Math.ceil(baseCost * 0.6 * 0.9));
  });

  it('matches game bundled cost for Speed Star with Prepared to Pass prerequisite', () => {
    const candidates: Record<string, CandidateSkill> = {
      [speedStarId]: {
        skillId: speedStarId,
        cost: skillsService.getById(speedStarId)?.baseCost ?? 0,
        netCost: skillsService.getById(speedStarId)?.baseCost ?? 0,
        hintLevel: 3,
        isStackable: false,
        isGold: true,
        whiteSkillId: preparedToPassId,
        baseTierIdForGold: preparedToPassId
      },
      [preparedToPassId]: {
        skillId: preparedToPassId,
        cost: skillsService.getById(preparedToPassId)?.baseCost ?? 0,
        netCost: skillsService.getById(preparedToPassId)?.baseCost ?? 0,
        hintLevel: 2,
        isStackable: false,
        isGold: false,
        goldSkillId: speedStarId
      }
    };

    expect(calculateDisplayCost(speedStarId, candidates, [], false)).toBe(270);
  });

  it('does not bundle white tiers when a gold-owned family already covers them', () => {
    const escapeArtistId = getSkillIdByName('Escape Artist');
    const goldCandidate: CandidateSkill = {
      skillId: escapeArtistId,
      cost: skillsService.getById(escapeArtistId)?.baseCost ?? 0,
      netCost: skillsService.getById(escapeArtistId)?.baseCost ?? 0,
      hintLevel: 0,
      isStackable: false,
      isGold: true,
      whiteSkillId: getWhiteVersion(escapeArtistId),
      baseTierIdForGold: getWhiteVersion(escapeArtistId)
    };

    const displayCost = calculateDisplayCost(
      escapeArtistId,
      { [escapeArtistId]: goldCandidate },
      [escapeArtistId],
      false
    );

    expect(displayCost).toBe(skillsService.getById(escapeArtistId)?.baseCost ?? 0);
  });
});
