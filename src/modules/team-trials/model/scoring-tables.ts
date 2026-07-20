const APTITUDE_GRADES = ['G', 'F', 'E', 'D', 'C', 'B', 'A', 'S'] as const;

export type AptitudeGrade = (typeof APTITUDE_GRADES)[number];

// Source: master.mdb team_stadium_evaluation_rate; cross-checked against GameTora and uma.guide Team Trials references.
export const SURFACE_AND_DISTANCE_EVALUATION_RATES = {
  G: 0.3,
  F: 0.4,
  E: 0.5,
  D: 0.6,
  C: 0.7,
  B: 0.9,
  A: 1,
  S: 1.02
} as const satisfies Record<AptitudeGrade, number>;

// Source: master.mdb team_stadium_evaluation_rate; cross-checked against GameTora and uma.guide Team Trials references.
export const RUNNING_STYLE_EVALUATION_RATES = {
  G: 0.7,
  F: 0.75,
  E: 0.8,
  D: 0.85,
  C: 0.9,
  B: 0.95,
  A: 1,
  S: 1.02
} as const satisfies Record<AptitudeGrade, number>;

// Source: master.mdb team_stadium_raw_score; cross-checked against GameTora's Team Trials (PvP) Scoring page.
export const FINISH_POSITION_POINTS = {
  1: 10_000,
  2: 8_000,
  3: 7_000,
  4: 6_000,
  5: 5_000,
  6: 4_000,
  7: 4_000,
  8: 3_000,
  9: 3_000,
  10: 2_000,
  11: 2_000,
  12: 2_000
} as const;

// Source: master.mdb team_stadium_raw_score; cross-checked against GameTora's Team Trials (PvP) Scoring page.
export const TEAM_BONUS_POINTS = {
  podiumSweep: 5_000,
  topFive: 4_000,
  twoMemberPodium: 3_000,
  matchWin: 10_000
} as const;

// Source: master.mdb team_stadium_raw_score; cross-checked against GameTora's Team Trials (PvP) Scoring page. Good Positioning, Long Shot, and the Rushed penalty were added from the uma.guide Team Trials scoring cross-check (2026-07-20).
export const RACE_EVENT_POINTS = {
  fastStart: 1_000,
  duelWin: 1_000,
  /** Awarded per race phase spent in a good position for the member's running style. */
  goodPositioningPerPhase: 1_000,
  /** Winning as a heavy underdog. */
  longShot: 4_000,
  /** Penalty when the member gets rushed (kakari). */
  rushed: -500
} as const;

/** Race phases (early/mid/late) that can each award the Good Positioning bonus. */
export const GOOD_POSITIONING_MAX_PHASES = 3;

// Source: master.mdb team_stadium_score_bonus rows 200-500. Corrected 2026-07-20 via uma.guide: these tiers are the WINSTREAK bonus, not opponent-rating tiers.
export const WINSTREAK_BONUS_PCTS = [0, 2, 3, 4, 5] as const;

// Source: uma.guide Team Trials scoring (2026-07-20). The opponent rating bonus is a ratio, not a tier table: opponent / (own + 200000 - opponent), routinely x1.1-1.2.
const OPPONENT_RATING_OFFSET = 200_000;

/** Neutral (x1.0) when either rating is unknown; otherwise the uma.guide ratio, clamped to a sane range. */
export function opponentRatingFactor(ownRating: number, opponentRating: number): number {
  if (ownRating <= 0 || opponentRating <= 0) return 1;

  const divisor = ownRating + OPPONENT_RATING_OFFSET - opponentRating;
  if (divisor <= 0) return 5;

  return Math.min(5, Math.max(0.1, opponentRating / divisor));
}

// Source: master.mdb team_stadium_raw_score; cross-checked against GameTora's Team Trials (PvP) Scoring page.
export const WIN_MARGIN_POINTS = {
  nose: 5_000,
  head: 3_000,
  neck: 2_000,
  halfLength: 1_000,
  threeQuarterLengths: 1_100,
  oneLength: 1_200,
  oneQuarterLengths: 1_300,
  oneHalfLengths: 1_400,
  oneThreeQuarterLengths: 1_500,
  twoLengths: 1_600,
  twoHalfLengths: 1_700,
  threeLengths: 1_800,
  threeHalfLengths: 1_900,
  fourLengths: 2_000,
  fiveLengths: 2_100,
  sixLengths: 2_200,
  sevenLengths: 2_300,
  eightLengths: 2_400,
  nineLengths: 2_500,
  tenLengths: 2_600,
  distance: 3_000
} as const;

export type MarginTier = keyof typeof WIN_MARGIN_POINTS;

// Source: master.mdb team_stadium_raw_score; cross-checked against GameTora's Team Trials (PvP) Scoring page.
export const UNIQUE_SKILL_PROC_POINTS = {
  1: { 1: 1_500, 2: 1_700, 3: 1_800, 4: 1_900, 5: 2_000 },
  2: { 1: 1_500, 2: 1_700, 3: 1_800, 4: 1_900, 5: 2_000 },
  3: { 1: 2_000, 2: 2_200, 3: 2_300, 4: 2_400, 5: 2_500 }
} as const;

// Source: master.mdb team_stadium_raw_score; cross-checked against GameTora's Team Trials (PvP) Scoring page.
export const SKILL_PROC_POINTS = {
  white: 500,
  inherited: 500,
  gold: 1_200
} as const;

// Source: master.mdb team_stadium_score_bonus (rate 1000 = 10%); cross-checked against GameTora and uma.guide Team Trials references.
export const ACE_SCORE_MULTIPLIER = 1.1;

// Source: master.mdb team_stadium_class; cross-checked against GameTora and uma.guide Team Trials references.
export const TEAM_SIZE_BY_CLASS = {
  1: 1,
  2: 2,
  3: 3,
  4: 3,
  5: 3,
  6: 3
} as const;
