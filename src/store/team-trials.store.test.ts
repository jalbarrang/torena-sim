import { beforeEach, describe, expect, it } from 'vitest';
import type { MemberRaceRow } from '@/modules/team-trials/model/score-sheet';
import type { Roster, RosterMember } from '@/modules/team-trials/model/types';
import {
  clearTeamTrialsRoster,
  defaultTeamTrialsState,
  getTeamTrialsRosterSnapshot,
  mergeTeamTrialsState,
  restoreTeamTrialsRoster,
  setTeamTrialsClass,
  useTeamTrialsStore
} from './team-trials.store';

function makeMember(outfitId: string): RosterMember {
  return {
    outfitId,
    charId: outfitId.slice(0, 4),
    fit: 1,
    surface: 'turf',
    distance: 'sprint',
    style: 'frontRunner',
    stars: 3,
    potential: 3,
    uniqueProcPoints: 1_200,
    isAce: false
  };
}

function makeRow(outfitId: string): MemberRaceRow {
  return {
    outfitId,
    place: 1,
    marginTier: 'oneLength',
    whiteProcs: 3,
    goldProcs: 1,
    inheritedProcs: 1,
    goodPositioningPhases: 2,
    timeBonus: 1_000,
    fastStart: false,
    longShot: false,
    rushed: false
  };
}

describe('team-trials.store persistence', () => {
  beforeEach(() => {
    useTeamTrialsStore.setState(defaultTeamTrialsState);
  });

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

  it('drops overflow slots, preserves a retained ace, and prunes their sheet overrides on class downgrade', () => {
    const roster: Roster = {
      sprint: ['100101', '100201', '100301'].map(makeMember),
      mile: ['200101', '200201', '200301'].map(makeMember),
      medium: [],
      long: [],
      dirt: []
    };

    useTeamTrialsStore.setState({
      teamClass: 6,
      assignments: {
        sprint: ['100101', '100201', '100301'],
        mile: ['200101', '200201', '200301']
      },
      aces: { sprint: '100201', mile: '200301' },
      sheetOverrides: {
        sprint: ['100101', '100201', '100301'].map(makeRow),
        mile: ['200101', '200201', '200301'].map(makeRow)
      }
    });

    setTeamTrialsClass(2, roster);

    const state = useTeamTrialsStore.getState();
    expect(state.teamClass).toBe(2);
    // Class downgrades preserve buildRoster's first-valid-assignment-wins slot order.
    expect(state.assignments).toEqual({
      sprint: ['100101', '100201'],
      mile: ['200101', '200201']
    });
    expect(state.aces).toEqual({ sprint: '100201' });
    expect(state.sheetOverrides).toEqual({
      sprint: ['100101', '100201'].map(makeRow),
      mile: ['200101', '200201'].map(makeRow)
    });
  });

  it('restores assignments, manual aces, and sheet overrides from a roster snapshot', () => {
    const sheetOverride = {
      outfitId: '100101',
      place: 1,
      marginTier: 'nose' as const,
      whiteProcs: 2,
      goldProcs: 1,
      inheritedProcs: 0,
      goodPositioningPhases: 1,
      timeBonus: 100,
      fastStart: true,
      longShot: true,
      rushed: false
    };

    useTeamTrialsStore.setState({
      assignments: { sprint: ['100101'], mile: ['100201'] },
      aces: { sprint: '100101' },
      sheetOverrides: { sprint: [sheetOverride] }
    });
    const snapshot = getTeamTrialsRosterSnapshot();

    clearTeamTrialsRoster();
    expect(useTeamTrialsStore.getState()).toMatchObject({
      assignments: {},
      aces: {},
      sheetOverrides: {}
    });

    restoreTeamTrialsRoster(snapshot);

    expect(useTeamTrialsStore.getState()).toMatchObject({
      assignments: { sprint: ['100101'], mile: ['100201'] },
      aces: { sprint: '100101' },
      sheetOverrides: { sprint: [sheetOverride] }
    });
  });
});
