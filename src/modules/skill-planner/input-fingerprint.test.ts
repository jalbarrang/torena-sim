import { describe, expect, it } from 'vitest';
import { createRaceConditions } from '@/utils/races';
import { createRunnerState } from '../runners/components/runner-card/domain/runner-state';
import { buildOptimizationInputFingerprint } from './input-fingerprint';
import type { CandidateSkill } from './types';

function createCandidate(skillId: string, hintLevel: CandidateSkill['hintLevel']): CandidateSkill {
  return {
    skillId,
    cost: 0,
    netCost: 0,
    hintLevel,
    isStackable: false,
    isGold: false
  };
}

describe('buildOptimizationInputFingerprint', () => {
  const baseParams = {
    courseId: 10507,
    racedef: createRaceConditions(),
    runner: createRunnerState(),
    obtainedSkillIds: ['skill-b'],
    candidates: {
      'skill-a': createCandidate('skill-a', 3),
      'skill-b': createCandidate('skill-b', 1)
    },
    skillMetaById: {
      'skill-a': { hintLevel: 3 as const },
      'skill-b': { hintLevel: 1 as const }
    },
    budget: 1000,
    hasFastLearner: false,
    ignoreStaminaConsumption: false,
    staminaDrainOverrides: {
      '100001': 0.45
    }
  };

  it('is stable for equivalent inputs regardless of object key order', () => {
    const fingerprintA = buildOptimizationInputFingerprint(baseParams);
    const fingerprintB = buildOptimizationInputFingerprint({
      ...baseParams,
      candidates: {
        'skill-b': baseParams.candidates['skill-b'],
        'skill-a': baseParams.candidates['skill-a']
      },
      skillMetaById: {
        'skill-b': baseParams.skillMetaById['skill-b'],
        'skill-a': baseParams.skillMetaById['skill-a']
      },
      staminaDrainOverrides: {
        '100001': 0.45
      }
    });

    expect(fingerprintA).toBe(fingerprintB);
  });

  it('changes when optimizer inputs change', () => {
    const fingerprintA = buildOptimizationInputFingerprint(baseParams);
    const fingerprintB = buildOptimizationInputFingerprint({
      ...baseParams,
      budget: 900
    });

    expect(fingerprintA).not.toBe(fingerprintB);
  });

  it('changes when stamina mode changes', () => {
    const fingerprintA = buildOptimizationInputFingerprint(baseParams);
    const fingerprintB = buildOptimizationInputFingerprint({
      ...baseParams,
      ignoreStaminaConsumption: true
    });

    expect(fingerprintA).not.toBe(fingerprintB);
  });
});
