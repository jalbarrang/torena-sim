import { describe, expect, it } from 'vitest';
import type { UmaAptitudes } from '@/modules/data/services/UmaService';
import type { UmaSearchEntry } from '@/modules/runners/utils';
import type { OwnedTrainee } from '@/store/trainee-list.store';
import { buildRoster } from './roster';

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

function makeUma(id: string): UmaSearchEntry {
  return { id, name: id, outfit: id, aptitudes: APTITUDES, rarity: 3 };
}

function makeOwned(umas: Array<UmaSearchEntry>): Record<string, OwnedTrainee> {
  return Object.fromEntries(umas.map((uma) => [uma.id, { stars: 3, potential: 3, addedAt: 0 }]));
}

describe('buildRoster', () => {
  it('materializes manual assignments, dropping duplicate characters and overflow', () => {
    const umas = ['100101', '100102', '100201', '100301', '100401'].map((id) => makeUma(id));
    const roster = buildRoster({
      // 100102 shares character 1001 with the already-assigned 100101; 100401 overflows team size 2.
      assignments: {
        sprint: ['100101', '100102', '100201', '100401'],
        mile: ['999901']
      },
      aces: {},
      umas,
      owned: makeOwned(umas),
      teamSize: 2
    });

    expect(roster.sprint.map((member) => member.outfitId)).toEqual(['100101', '100201']);
    expect(roster.mile).toEqual([]);
    expect(roster.sprint.filter((member) => member.isAce)).toHaveLength(1);
  });

  it('honors a valid ace override and ignores a stale one', () => {
    const umas = [makeUma('100101'), makeUma('100201')];
    const owned = {
      '100101': { stars: 5, potential: 5, addedAt: 0 },
      '100201': { stars: 1, potential: 1, addedAt: 0 }
    };
    const input = {
      assignments: { sprint: ['100101', '100201'] },
      umas,
      owned,
      teamSize: 2 as const
    };

    const overridden = buildRoster({ ...input, aces: { sprint: '100201' } });
    expect(overridden.sprint.find((member) => member.isAce)?.outfitId).toBe('100201');

    const stale = buildRoster({ ...input, aces: { sprint: '999901' } });
    expect(stale.sprint.find((member) => member.isAce)?.outfitId).toBe('100101');
  });
});
