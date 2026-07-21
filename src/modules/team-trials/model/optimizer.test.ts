import { describe, expect, it } from 'vitest';
import type { UmaAptitudes } from '@/modules/data/services/UmaService';
import type { UmaSearchEntry } from '@/modules/runners/utils';
import type { OwnedTrainee } from '@/store/trainee-list.store';
import { optimizeRoster, type OptimizeInput } from './optimizer';

const APTITUDES: UmaAptitudes = {
  turf: 'A',
  dirt: 'A',
  sprint: 'A',
  mile: 'A',
  medium: 'A',
  long: 'A',
  frontRunner: 'A',
  paceChaser: 'A',
  lateSurger: 'B',
  endCloser: 'B'
};

function makeUma(id: string, aptitudes = APTITUDES): UmaSearchEntry {
  return { id, name: id, outfit: id, aptitudes, rarity: 3 };
}

function makeOwned(umas: Array<UmaSearchEntry>): Record<string, OwnedTrainee> {
  return Object.fromEntries(umas.map((uma) => [uma.id, { stars: 3, potential: 3, addedAt: 0 }]));
}

function makeInput(overrides: Partial<OptimizeInput> = {}): OptimizeInput {
  const umas = Array.from({ length: 10 }, (_, index) =>
    makeUma(`10${String(index + 1).padStart(2, '0')}01`)
  );

  return {
    umas,
    owned: makeOwned(umas),
    teamSize: 1,
    pinned: {},
    excluded: [],
    ...overrides
  };
}

describe('optimizeRoster', () => {
  it('uses each character in at most one category', () => {
    const roster = optimizeRoster(makeInput());
    const members = Object.values(roster).flat();

    expect(members).toHaveLength(5);
    expect(new Set(members.map((member) => member.charId)).size).toBe(members.length);
  });

  it('uses the better of sprint and mile aptitude for dirt', () => {
    const dirtSpecialist = makeUma('100101', {
      ...APTITUDES,
      sprint: 'B',
      mile: 'A'
    });
    const roster = optimizeRoster(
      makeInput({
        umas: [dirtSpecialist],
        owned: makeOwned([dirtSpecialist]),
        pinned: { '100101': 'dirt' }
      })
    );

    expect(roster.dirt[0]).toMatchObject({ outfitId: '100101', distance: 'mile' });
  });

  it('honors pins and exclusions', () => {
    const input = makeInput({
      pinned: { '100101': 'long' },
      excluded: ['100201']
    });
    const roster = optimizeRoster(input);
    const members = Object.values(roster).flat();

    expect(roster.long.some((member) => member.outfitId === '100101')).toBe(true);
    expect(members.some((member) => member.outfitId === '100201')).toBe(false);
  });

  it.each([1, 2] as const)('fills every category for team size %i', (teamSize) => {
    const roster = optimizeRoster(makeInput({ teamSize }));

    expect(Object.values(roster).every((members) => members.length === teamSize)).toBe(true);
  });

  it('prefers style diversity among exactly tied candidates (good positioning)', () => {
    const frontA = makeUma('100101', { ...APTITUDES, paceChaser: 'B' });
    const frontB = makeUma('100201', { ...APTITUDES, paceChaser: 'B' });
    const pace = makeUma('100301', { ...APTITUDES, frontRunner: 'B', paceChaser: 'A' });
    const umas = [frontA, frontB, pace];
    const roster = optimizeRoster(makeInput({ umas, owned: makeOwned(umas), teamSize: 2 }));

    // All three tie on fit/stars/potential; the second dirt slot should take the pace chaser over the duplicate front runner.
    expect(new Set(roster.dirt.map((member) => member.style))).toEqual(
      new Set(['frontRunner', 'paceChaser'])
    );
  });
});
