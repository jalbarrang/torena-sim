import { describe, expect, it } from 'vitest';
import { defaultTeamTrialsState, mergeTeamTrialsState } from './team-trials.store';

describe('team-trials.store persistence', () => {
  it('normalizes corrupt persisted values during merge', () => {
    const state = mergeTeamTrialsState(
      {
        teamClass: 99,
        assignments: {
          mile: ['100101', 42, '100101'],
          'not-a-category': ['100301']
        },
        aces: { mile: '100101', dirt: 42, 'not-a-category': '100301' },
        multipliers: {
          supportBonusPct: -10,
          winstreakBonusPct: 99,
          ownRating: 'high',
          opponentRating: -5,
          campaignMultiplier: 9
        },
        sheetOverrides: {
          sprint: [
            {
              outfitId: '100101',
              place: 99,
              marginTier: 'nose',
              whiteProcs: -1,
              goldProcs: 2.8,
              inheritedProcs: 'bad',
              goodPositioningPhases: 99,
              timeBonus: 9999,
              fastStart: 'yes',
              longShot: 'yes',
              rushed: 1
            },
            { outfitId: 42 }
          ],
          invalidCategory: []
        }
      },
      defaultTeamTrialsState
    );

    expect(state.teamClass).toBe(1);
    expect(state.assignments).toEqual({ mile: ['100101'] });
    expect(state.aces).toEqual({ mile: '100101' });
    expect(state.multipliers).toEqual({
      supportBonusPct: 0,
      winstreakBonusPct: 0,
      ownRating: 0,
      opponentRating: 0,
      campaignMultiplier: 1
    });
    expect(state.sheetOverrides).toEqual({
      sprint: [
        {
          outfitId: '100101',
          place: 12,
          marginTier: null,
          whiteProcs: 0,
          goldProcs: 2,
          inheritedProcs: 0,
          goodPositioningPhases: 3,
          timeBonus: 2_000,
          fastStart: false,
          longShot: false,
          rushed: false
        }
      ]
    });
  });
});
