import { describe, expect, it } from 'vitest';
import {
  areAlternativesSimulatable,
  extractConditionTokens,
  findUnknownConditionTokens,
  findUnsupportedSkillMechanics,
  isConditionSimulatable
} from './simulatability';
import { skillsService } from '@/modules/data/services/SkillService';

describe('extractConditionTokens', () => {
  it('extracts identifier tokens from a condition string', () => {
    expect(extractConditionTokens('distance_rate>=50&order_rate<=30')).toEqual([
      'distance_rate',
      'order_rate'
    ]);
  });

  it('handles compound tokens with digits', () => {
    expect(extractConditionTokens('order_rate_in20_continue==1')).toEqual([
      'order_rate_in20_continue'
    ]);
  });

  it('returns empty array for empty string', () => {
    expect(extractConditionTokens('')).toEqual([]);
  });

  it('handles conditions with @ (or) operator', () => {
    expect(extractConditionTokens('phase==2@phase==3')).toEqual(['phase', 'phase']);
  });

  it('skips standalone numbers', () => {
    expect(extractConditionTokens('order>=1&order<=3')).toEqual(['order', 'order']);
  });
});

describe('isConditionSimulatable', () => {
  it('returns true for empty condition', () => {
    expect(isConditionSimulatable('')).toBe(true);
  });

  it('returns true for known conditions', () => {
    expect(isConditionSimulatable('distance_rate>=50&order_rate<=30')).toBe(true);
    expect(isConditionSimulatable('is_finalcorner==1&corner==0')).toBe(true);
    expect(isConditionSimulatable('phase==2@phase==3')).toBe(true);
  });

  it('returns false for unknown conditions', () => {
    expect(isConditionSimulatable('some_future_mechanic>=1')).toBe(false);
    expect(isConditionSimulatable('distance_rate>=50&unknown_token==1')).toBe(false);
  });
});

describe('areAlternativesSimulatable', () => {
  it('returns true when all alternatives have known conditions', () => {
    expect(
      areAlternativesSimulatable([
        { condition: 'distance_rate>=50', baseDuration: 60000, effects: [] },
        { condition: 'phase==3&is_lastspurt==1', baseDuration: 60000, effects: [] }
      ])
    ).toBe(true);
  });

  it('returns false when any alternative has an unknown condition', () => {
    expect(
      areAlternativesSimulatable([
        { condition: 'distance_rate>=50', baseDuration: 60000, effects: [] },
        { condition: 'new_future_condition>=1', baseDuration: 60000, effects: [] }
      ])
    ).toBe(false);
  });

  it('checks preconditions too', () => {
    expect(
      areAlternativesSimulatable([
        {
          condition: 'distance_rate>=50',
          precondition: 'unknown_precond==1',
          baseDuration: 60000,
          effects: []
        }
      ])
    ).toBe(false);
  });

  it('returns true for empty alternatives', () => {
    expect(areAlternativesSimulatable([])).toBe(true);
  });

  it('returns false when any effect uses an unsupported value policy', () => {
    expect(
      areAlternativesSimulatable([
        {
          condition: 'distance_rate>=50',
          baseDuration: 60000,
          effects: [{ type: 27, modifier: 500, target: 1, valueUsage: 13 }]
        }
      ])
    ).toBe(false);
  });
});

describe('findUnknownConditionTokens', () => {
  it('returns empty array for fully supported skills', () => {
    expect(
      findUnknownConditionTokens([
        { condition: 'distance_rate>=50&phase==2', baseDuration: 60000, effects: [] }
      ])
    ).toEqual([]);
  });

  it('returns unknown tokens', () => {
    const unknown = findUnknownConditionTokens([
      { condition: 'distance_rate>=50&future_thing==1', baseDuration: 60000, effects: [] },
      {
        condition: 'another_new>=2',
        precondition: 'also_unknown==1',
        baseDuration: 60000,
        effects: []
      }
    ]);
    expect(unknown).toContain('future_thing');
    expect(unknown).toContain('another_new');
    expect(unknown).toContain('also_unknown');
    expect(unknown).not.toContain('distance_rate');
  });
});

describe('findUnsupportedSkillMechanics', () => {
  it('reports unsupported value usages separately from condition tokens', () => {
    expect(
      findUnsupportedSkillMechanics([
        {
          condition: 'distance_rate>=50',
          baseDuration: 60000,
          effects: [{ type: 27, modifier: 500, target: 1, valueUsage: 13 }]
        }
      ])
    ).toEqual([{ kind: 'value-usage', usage: 13 }]);
  });

  it('treats usage 14 (activated-tag count) as supported', () => {
    expect(
      findUnsupportedSkillMechanics([
        {
          condition: 'distance_rate>=50',
          baseDuration: 60000,
          effects: [{ type: 27, modifier: 500, target: 1, valueUsage: 14 }]
        }
      ])
    ).toEqual([]);
  });
});

describe('SkillService.isSimulatable', () => {
  it('returns true for known skills in the current dataset', () => {
    // Kitasan Black unique — uses well-known conditions
    expect(skillsService.isSimulatable('10351')).toBe(true);
  });

  it('returns false for non-existent skill IDs', () => {
    expect(skillsService.isSimulatable('999999999')).toBe(false);
  });

  it('rejects released skills with reviewed unsupported value usages', () => {
    const unsupported = [
      '210011',
      '210012',
      '210021',
      '210022',
      '210031',
      '210032',
      '210041',
      '210042',
      '210051',
      '210052',
      '210061',
      '210062',
      '210081',
      '210082'
    ];

    for (const skillId of unsupported) {
      expect(skillsService.isSimulatable(skillId)).toBe(false);
    }
  });

  it('treats Copano Rickey Luck Runs My Way (100981, usage 14) as simulatable', () => {
    expect(skillsService.isSimulatable('100981')).toBe(true);
  });
});
