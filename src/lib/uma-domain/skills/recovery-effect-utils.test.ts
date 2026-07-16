import { describe, expect, it } from 'vitest';
import { skillsService } from '@/modules/data/services/SkillService';
import { SkillType } from './definitions';
import { resolveRecoveryModifier } from './recovery-effect-utils';
import { describeRecoveryEffect } from './value-scaling/multiply-random';

function createSkillRng(roll: number) {
  return {
    random: () => roll
  };
}

describe('resolveRecoveryModifier', () => {
  it('returns the raw modifier for direct negative recovery effects', () => {
    expect(
      resolveRecoveryModifier(
        {
          type: SkillType.Recovery,
          modifier: -0.125
        },
        createSkillRng(0.95)
      )
    ).toBe(-0.125);
  });

  it('maps MultiplyRandom recovery drains for valueUsage 8/9 into the documented split', () => {
    expect(
      resolveRecoveryModifier(
        {
          type: SkillType.Recovery,
          modifier: -1,
          valueUsage: 8
        },
        createSkillRng(0.1)
      )
    ).toBe(0);

    expect(
      resolveRecoveryModifier(
        {
          type: SkillType.Recovery,
          modifier: -1,
          valueUsage: 8
        },
        createSkillRng(0.6)
      )
    ).toBe(-0.02);

    expect(
      resolveRecoveryModifier(
        {
          type: SkillType.Recovery,
          modifier: -1,
          valueUsage: 9
        },
        createSkillRng(0.95)
      )
    ).toBe(-0.04);
  });

  it('scales MultiplyRandom results from the raw modifier instead of assuming a fixed -100% base', () => {
    expect(
      resolveRecoveryModifier(
        {
          type: SkillType.Recovery,
          modifier: -0.5,
          valueUsage: 8
        },
        createSkillRng(0.6)
      )
    ).toBe(-0.01);

    expect(
      resolveRecoveryModifier(
        {
          type: SkillType.Recovery,
          modifier: -0.5,
          valueUsage: 8
        },
        createSkillRng(0.95)
      )
    ).toBe(-0.02);
  });

  it('maps MultiplyRandom positive recovery for valueUsage 8/9 into the documented split', () => {
    expect(
      resolveRecoveryModifier(
        {
          type: SkillType.Recovery,
          modifier: 1,
          valueUsage: 8
        },
        createSkillRng(0.1)
      )
    ).toBe(0);

    expect(
      resolveRecoveryModifier(
        {
          type: SkillType.Recovery,
          modifier: 1,
          valueUsage: 8
        },
        createSkillRng(0.6)
      )
    ).toBe(0.02);

    expect(
      resolveRecoveryModifier(
        {
          type: SkillType.Recovery,
          modifier: 0.5,
          valueUsage: 9
        },
        createSkillRng(0.95)
      )
    ).toBe(0.02);
  });

  it('lets manual overrides win over built-in MultiplyRandom resolution', () => {
    expect(
      resolveRecoveryModifier(
        {
          type: SkillType.Recovery,
          modifier: -1,
          valueUsage: 8
        },
        createSkillRng(0.95),
        0.35
      )
    ).toBe(-0.35);
  });
});

describe('describeRecoveryEffect', () => {
  it('formats the supported MultiplyRandom split from the raw modifier', () => {
    expect(
      describeRecoveryEffect({
        type: SkillType.Recovery,
        modifier: -1,
        valueUsage: 8
      })
    ).toBe('60% chance to drain nothing, 30% to drain 2%, 10% to drain 4%');

    expect(
      describeRecoveryEffect({
        type: SkillType.Recovery,
        modifier: -0.5,
        valueUsage: 8
      })
    ).toBe('60% chance to drain nothing, 30% to drain 1%, 10% to drain 2%');

    expect(
      describeRecoveryEffect({
        type: SkillType.Recovery,
        modifier: 1,
        valueUsage: 8
      })
    ).toBe('60% chance to recover nothing, 30% to recover 2%, 10% to recover 4%');
  });
});

describe('extracted skill metadata', () => {
  it.each(['202031', '202032'])('preserves valueUsage metadata for %s', (skillId) => {
    const skill = skillsService.getById(skillId);
    const recoveryEffect = skill?.alternatives[0]?.effects.find(
      (effect) => effect.type === SkillType.Recovery && effect.modifier < 0
    );

    expect(recoveryEffect).toMatchObject({
      valueUsage: 8,
      valueLevelUsage: 1
    });
  });
});
