import type { Roster, RosterCategory, RosterMember } from './types';
import {
  ACE_SCORE_MULTIPLIER,
  FINISH_POSITION_POINTS,
  opponentRatingFactor,
  RACE_EVENT_POINTS,
  SKILL_PROC_POINTS,
  TEAM_BONUS_POINTS,
  WIN_MARGIN_POINTS,
  type MarginTier
} from './scoring-tables';

export type { MarginTier };

export type MemberRaceRow = {
  outfitId: string;
  place: number;
  marginTier: MarginTier | null;
  whiteProcs: number;
  goldProcs: number;
  inheritedProcs: number;
  /** Race phases (0-3) spent in a good position for the member's style, +1,000 each. */
  goodPositioningPhases: number;
  timeBonus: number;
  fastStart: boolean;
  /** Won as a heavy underdog (+4,000); only counts when place is 1st. */
  longShot: boolean;
  /** Got rushed / kakari (-500). */
  rushed: boolean;
};

export type RaceSheet = {
  category: RosterCategory;
  rows: Array<MemberRaceRow>;
};

export type SheetMultipliers = {
  supportBonusPct: number;
  /** team_stadium_score_bonus rows 200-500: consecutive-win bonus, additive with the support bonus. */
  winstreakBonusPct: 0 | 2 | 3 | 4 | 5;
  /** Team ratings feeding the opponent factor: opp / (own + 200000 - opp). Zero means unknown -> neutral x1. */
  ownRating: number;
  opponentRating: number;
  campaignMultiplier: 1 | 1.5 | 2 | 3;
};

type MemberScore = {
  outfitId: string;
  positionPoints: number;
  marginPoints: number;
  whiteProcPoints: number;
  goldProcPoints: number;
  inheritedProcPoints: number;
  uniqueProcPoints: number;
  goodPositioningPoints: number;
  timeBonus: number;
  fastStartPoints: number;
  longShotPoints: number;
  rushedPoints: number;
  baseTotal: number;
  aceBonusPoints: number;
  totalBeforeGlobal: number;
};

export type RaceResult = {
  category: RosterCategory;
  members: Array<MemberScore>;
  teamBonusPoints: number;
  won: boolean;
  totalBeforeGlobal: number;
  total: number;
};

export type SheetResult = {
  races: Array<RaceResult>;
  matchWinPoints: number;
  /** 1 + supportBonusPct/100 + winstreakBonusPct/100 */
  bonusMultiplier: number;
  /** opp / (own + 200000 - opp), or 1 when ratings are unknown. */
  opponentFactor: number;
  globalMultiplier: number;
  totalBeforeGlobal: number;
  total: number;
};

function getMember(
  roster: Roster,
  category: RosterCategory,
  outfitId: string
): RosterMember | undefined {
  return roster[category].find((member) => member.outfitId === outfitId);
}

function getPositionPoints(place: number): number {
  return FINISH_POSITION_POINTS[place as keyof typeof FINISH_POSITION_POINTS] ?? 0;
}

function teamBonus(rows: Array<MemberRaceRow>): number {
  if (rows.length === 2 && rows.every((row) => row.place <= 3)) {
    return TEAM_BONUS_POINTS.twoMemberPodium;
  }

  if (rows.length >= 3 && [1, 2, 3].every((place) => rows.some((row) => row.place === place))) {
    return TEAM_BONUS_POINTS.podiumSweep;
  }

  if (rows.length >= 3 && rows.every((row) => row.place <= 5)) {
    return TEAM_BONUS_POINTS.topFive;
  }

  return 0;
}

function scoreMember(member: RosterMember | undefined, row: MemberRaceRow): MemberScore {
  const positionPoints = getPositionPoints(row.place);
  const marginPoints = row.place === 1 && row.marginTier ? WIN_MARGIN_POINTS[row.marginTier] : 0;
  const whiteProcPoints = row.whiteProcs * SKILL_PROC_POINTS.white;
  const goldProcPoints = row.goldProcs * SKILL_PROC_POINTS.gold;
  const inheritedProcPoints = row.inheritedProcs * SKILL_PROC_POINTS.inherited;
  const uniqueProcPoints = member?.uniqueProcPoints ?? 0;
  const goodPositioningPoints =
    row.goodPositioningPhases * RACE_EVENT_POINTS.goodPositioningPerPhase;
  const fastStartPoints = row.fastStart ? RACE_EVENT_POINTS.fastStart : 0;
  const longShotPoints = row.longShot && row.place === 1 ? RACE_EVENT_POINTS.longShot : 0;
  const rushedPoints = row.rushed ? RACE_EVENT_POINTS.rushed : 0;
  const baseTotal =
    positionPoints +
    marginPoints +
    whiteProcPoints +
    goldProcPoints +
    inheritedProcPoints +
    uniqueProcPoints +
    goodPositioningPoints +
    row.timeBonus +
    fastStartPoints +
    longShotPoints +
    rushedPoints;
  const aceBonusPoints = member?.isAce
    ? Math.round(baseTotal * ACE_SCORE_MULTIPLIER) - baseTotal
    : 0;

  return {
    outfitId: row.outfitId,
    positionPoints,
    marginPoints,
    whiteProcPoints,
    goldProcPoints,
    inheritedProcPoints,
    uniqueProcPoints,
    goodPositioningPoints,
    timeBonus: row.timeBonus,
    fastStartPoints,
    longShotPoints,
    rushedPoints,
    baseTotal,
    aceBonusPoints,
    totalBeforeGlobal: baseTotal + aceBonusPoints
  };
}

export function defaultRaceSheets(roster: Roster): Array<RaceSheet> {
  return (Object.keys(roster) as Array<RosterCategory>).map((category) => ({
    category,
    rows: roster[category].map((member, index) => ({
      outfitId: member.outfitId,
      place: index + 1,
      marginTier: index === 0 ? 'oneLength' : null,
      whiteProcs: 3,
      goldProcs: 1,
      inheritedProcs: 1,
      goodPositioningPhases: index === 0 ? 2 : 1,
      timeBonus: 1_000,
      fastStart: false,
      longShot: false,
      rushed: false
    }))
  }));
}

export function computeSheet(
  roster: Roster,
  races: Array<RaceSheet>,
  multipliers: SheetMultipliers
): SheetResult {
  const bonusMultiplier =
    1 + multipliers.supportBonusPct / 100 + multipliers.winstreakBonusPct / 100;
  const opponentFactor = opponentRatingFactor(multipliers.ownRating, multipliers.opponentRating);
  const globalMultiplier = bonusMultiplier * opponentFactor * multipliers.campaignMultiplier;
  const racesBeforeMatchBonus = races.map((race) => {
    const members = race.rows.map((row) =>
      scoreMember(getMember(roster, race.category, row.outfitId), row)
    );
    const teamBonusPoints = teamBonus(race.rows);
    const totalBeforeGlobal =
      members.reduce((total, member) => total + member.totalBeforeGlobal, 0) + teamBonusPoints;

    return {
      category: race.category,
      members,
      teamBonusPoints,
      won: race.rows.some((row) => row.place === 1),
      totalBeforeGlobal
    };
  });
  const matchWinPoints =
    racesBeforeMatchBonus.filter((race) => race.won).length >= 3 ? TEAM_BONUS_POINTS.matchWin : 0;
  const totalBeforeGlobal =
    racesBeforeMatchBonus.reduce((total, race) => total + race.totalBeforeGlobal, 0) +
    matchWinPoints;

  return {
    races: racesBeforeMatchBonus.map((race) => ({
      ...race,
      total: Math.round(race.totalBeforeGlobal * globalMultiplier)
    })),
    matchWinPoints,
    bonusMultiplier,
    opponentFactor,
    globalMultiplier,
    totalBeforeGlobal,
    total: Math.round(totalBeforeGlobal * globalMultiplier)
  };
}
