import { describe, expect, it } from 'vitest';
import type { Roster, RosterMember } from './types';
import { computeSheet, type MemberRaceRow, type SheetMultipliers } from './score-sheet';

const DEFAULT_MULTIPLIERS: SheetMultipliers = {
  supportBonusPct: 0,
  winstreakBonusPct: 0,
  ownRating: 0,
  opponentRating: 0,
  campaignMultiplier: 1
};

function makeMember(isAce = true): RosterMember {
  return {
    outfitId: '100101',
    charId: '1001',
    fit: 1,
    surface: 'turf',
    distance: 'sprint',
    style: 'frontRunner',
    stars: 3,
    potential: 3,
    uniqueProcPoints: 2_500,
    isAce
  };
}

function makeRoster(member = makeMember()): Roster {
  return {
    sprint: [member],
    mile: [],
    medium: [],
    long: [],
    dirt: []
  };
}

function makeRow(overrides: Partial<MemberRaceRow> = {}): MemberRaceRow {
  return {
    outfitId: '100101',
    place: 1,
    marginTier: 'oneLength',
    whiteProcs: 2,
    goldProcs: 1,
    inheritedProcs: 1,
    goodPositioningPhases: 0,
    timeBonus: 100,
    fastStart: true,
    longShot: false,
    rushed: false,
    ...overrides
  };
}

describe('computeSheet', () => {
  it('calculates exact fixture totals from row inputs', () => {
    const result = computeSheet(makeRoster(), [{ category: 'sprint', rows: [makeRow()] }], {
      ...DEFAULT_MULTIPLIERS,
      supportBonusPct: 10,
      winstreakBonusPct: 5,
      campaignMultiplier: 2
    });

    expect(result.races[0].members[0]).toMatchObject({
      baseTotal: 17_500,
      aceBonusPoints: 1_750,
      totalBeforeGlobal: 19_250
    });
    expect(result.totalBeforeGlobal).toBe(19_250);
    expect(result.total).toBe(44_275);
  });

  it('applies the ace bonus to member earnings before global multipliers', () => {
    const result = computeSheet(
      makeRoster(),
      [
        {
          category: 'sprint',
          rows: [
            makeRow({
              whiteProcs: 0,
              goldProcs: 0,
              inheritedProcs: 0,
              timeBonus: 0,
              fastStart: false,
              marginTier: null
            })
          ]
        }
      ],
      { ...DEFAULT_MULTIPLIERS, supportBonusPct: 10 }
    );

    expect(result.races[0].members[0]).toMatchObject({
      baseTotal: 12_500,
      aceBonusPoints: 1_250,
      totalBeforeGlobal: 13_750
    });
    expect(result.total).toBe(15_125);
  });

  it('counts a win margin only for first place', () => {
    const result = computeSheet(
      makeRoster(makeMember(false)),
      [{ category: 'sprint', rows: [makeRow({ place: 2, marginTier: 'nose' })] }],
      DEFAULT_MULTIPLIERS
    );

    expect(result.races[0].members[0].marginPoints).toBe(0);
  });

  it('scales the total linearly with the campaign multiplier', () => {
    const races = [{ category: 'sprint' as const, rows: [makeRow()] }];
    const baseline = computeSheet(makeRoster(), races, DEFAULT_MULTIPLIERS);
    const campaign = computeSheet(makeRoster(), races, {
      ...DEFAULT_MULTIPLIERS,
      campaignMultiplier: 3
    });

    expect(campaign.total).toBe(baseline.total * 3);
  });

  it('scores good positioning, long shot, and the rushed penalty', () => {
    const result = computeSheet(
      makeRoster(makeMember(false)),
      [
        {
          category: 'sprint',
          rows: [makeRow({ goodPositioningPhases: 3, longShot: true, rushed: true })]
        }
      ],
      DEFAULT_MULTIPLIERS
    );

    expect(result.races[0].members[0]).toMatchObject({
      goodPositioningPoints: 3_000,
      longShotPoints: 4_000,
      rushedPoints: -500,
      baseTotal: 24_000
    });
  });

  it('ignores long shot unless the member won the race', () => {
    const result = computeSheet(
      makeRoster(makeMember(false)),
      [{ category: 'sprint', rows: [makeRow({ place: 2, marginTier: null, longShot: true })] }],
      DEFAULT_MULTIPLIERS
    );

    expect(result.races[0].members[0].longShotPoints).toBe(0);
  });

  it('derives the opponent factor from team ratings and stays neutral when unknown', () => {
    const races = [{ category: 'sprint' as const, rows: [makeRow()] }];
    const neutral = computeSheet(makeRoster(), races, DEFAULT_MULTIPLIERS);
    const rated = computeSheet(makeRoster(), races, {
      ...DEFAULT_MULTIPLIERS,
      ownRating: 300_000,
      opponentRating: 275_000
    });

    expect(neutral.opponentFactor).toBe(1);
    // 275000 / (300000 + 200000 - 275000) = 275000 / 225000
    expect(rated.opponentFactor).toBeCloseTo(275_000 / 225_000, 10);
    expect(rated.total).toBe(Math.round(rated.totalBeforeGlobal * rated.opponentFactor));
  });
});
