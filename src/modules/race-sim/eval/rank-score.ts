import type { IRunnerState } from '@/modules/runners/components/runner-card/domain/runner-state';
import { aptitudeToEncoding } from '@/modules/runners/share/converters';
import { bucketsFromRunner } from '@/modules/runners/aptitude-buckets';
import skillGradesJson from './skill-grades.json';

/**
 * Native career-evaluation (評価点 / rank score) estimate.
 *
 * Ported from hachimi-redux `evaluation.rs` (itself the UmaTools model):
 *
 *   total = Σ stat_score(stat) + Σ skill_score + unique_bonus
 *   skill_score = round(gradeValue × aptitude_multiplier)   // per non-unique skill
 *   unique_bonus = uniqueSkillLevel × (170 if ★≥3 else 120)
 *
 * The stat curve is the reconstructed "umakonga" per-point formula. Validated to
 * within ~0–2% of real runners; the residual is entirely the unknown unique-skill
 * level (we assume a maxed ★3+ unique by default).
 */

type SkillGrade = { g: number; r?: string; u?: number };

const SKILL_GRADES = skillGradesJson as Record<string, SkillGrade>;

const MAX_STAT = 2500;

function buildStatTable(): Int32Array {
  const R1 = [
    5, 8, 10, 13, 16, 18, 21, 24, 26, 28, 29, 30, 31, 33, 34, 35, 39, 41, 42, 43, 52, 55, 66, 68, 68
  ];
  const R2 = [
    79, 80, 81, 83, 84, 85, 86, 88, 89, 90, 92, 93, 94, 96, 97, 98, 100, 101, 102, 103, 105, 106,
    107, 109, 110, 111, 113, 114, 115, 117, 118, 119, 121, 122, 123, 124, 126, 127, 128, 130, 131,
    132, 134, 135, 136, 138, 139, 140, 141, 143, 144, 145, 147, 148, 149, 151, 152, 153, 155, 156,
    157, 159, 160, 161, 162, 164, 165, 166, 168, 169, 170, 172, 173, 174, 176, 177, 178, 179, 181,
    182, 182
  ];
  const round10 = (raw: number) => Math.floor(raw / 10 + 0.5);

  const sc = new Int32Array(MAX_STAT + 1);
  let raw = 0;
  let idx = 0;
  for (let c = 1; c <= 1200; c++) {
    if (c <= 49) idx = 0;
    else if (c <= 99) idx = 1;
    else if (c % 50 === 0) idx++;
    raw += R1[idx];
    sc[c] = round10(raw);
  }
  raw = 38413;
  idx = 0;
  for (let c = 1201; c <= 2000; c++) {
    if (c <= 1209) idx = 0;
    else if (c <= 1219) idx = 1;
    else if (c % 10 === 0) idx++;
    raw += R2[idx];
    sc[c] = round10(raw);
  }
  raw = 142796;
  idx = 0;
  let rate = 183;
  for (let c = 2001; c <= MAX_STAT; c++) {
    if (idx >= 25) {
      rate += 1;
      idx = 0;
    }
    raw += rate;
    idx += 1;
    sc[c] = round10(raw);
  }
  return sc;
}

let statTable: Int32Array | null = null;

function statScore(stat: number): number {
  if (!statTable) statTable = buildStatTable();
  const s = Math.max(0, Math.min(MAX_STAT, Math.round(stat)));
  return statTable[s];
}

function bucketMultiplier(grade: number): number {
  if (grade >= 7) return 1.1; // S, A
  if (grade >= 5) return 0.9; // B, C
  if (grade >= 2) return 0.8; // D, E, F
  if (grade === 1) return 0.7; // G
  return 1.0; // none
}

const ROLE_CATEGORY: Record<string, number> = {
  turf: 0,
  dirt: 0,
  sprint: 1,
  mile: 1,
  medium: 1,
  long: 1,
  front: 2,
  pace: 2,
  late: 2,
  end: 2
};

export type RankAptitudes = Record<string, number>;

function roleMultiplier(apt: RankAptitudes, role: string): number {
  const best: Array<number | null> = [null, null, null, null];
  for (const part of role.split('/')) {
    const grade = apt[part];
    if (grade === undefined) continue;
    const category = ROLE_CATEGORY[part] ?? 3;
    const m = bucketMultiplier(grade);
    best[category] = best[category] === null ? m : Math.max(best[category]!, m);
  }
  let factor = 1;
  let any = false;
  for (const b of best) {
    if (b !== null) {
      factor *= b;
      any = true;
    }
  }
  return any ? factor : 1;
}

export type RankScoreOptions = {
  /** Character star rating: ★≥3 scores uniques at 170/level, else 120. */
  star?: number;
  /** Assumed unique-skill level when not otherwise known (game caps at 6). */
  uniqueLevel?: number;
  /** Per-unique-skill levels (base id -> level); overrides `uniqueLevel`. */
  uniqueLevels?: Record<string, number>;
};

/**
 * Core evaluation. `skillIds` are base skill ids (no level suffix). `apt` maps
 * role keys (turf/dirt/sprint/mile/medium/long/front/pace/late/end) to grade
 * numbers (S=8 … G=1).
 */
export function computeRankScore(
  stats: [number, number, number, number, number],
  apt: RankAptitudes,
  skillIds: string[],
  options: RankScoreOptions = {}
): number {
  const star = options.star ?? 3;
  const uniqueLevel = options.uniqueLevel ?? 6;

  let total = 0;
  for (const stat of stats) total += statScore(stat);

  for (const id of skillIds) {
    const grade = SKILL_GRADES[id];
    if (!grade) continue;
    if (grade.u === 1) {
      const level = options.uniqueLevels?.[id] ?? uniqueLevel;
      total += level * (star >= 3 ? 170 : 120);
      continue;
    }
    const factor = grade.r ? roleMultiplier(apt, grade.r) : 1;
    total += Math.round(grade.g * factor);
  }

  return total;
}

function runnerAptitudes(runner: IRunnerState): RankAptitudes {
  // bucketsFromRunner backfills any missing bucket (and broadcasts the collapsed
  // grades when there is no per-bucket data).
  const full = bucketsFromRunner(runner);
  return {
    turf: aptitudeToEncoding(full.turf),
    dirt: aptitudeToEncoding(full.dirt),
    sprint: aptitudeToEncoding(full.distanceShort),
    mile: aptitudeToEncoding(full.distanceMile),
    medium: aptitudeToEncoding(full.distanceMiddle),
    long: aptitudeToEncoding(full.distanceLong),
    front: aptitudeToEncoding(full.nige),
    pace: aptitudeToEncoding(full.senko),
    late: aptitudeToEncoding(full.sashi),
    end: aptitudeToEncoding(full.oikomi)
  };
}

/**
 * Estimate a runner's rank score from its stats, aptitudes, and skills. Returns
 * the imported `rankScore` directly when present (the game's real value).
 */
export function estimateRunnerRankScore(runner: IRunnerState, options?: RankScoreOptions): number {
  if (typeof runner.rankScore === 'number') {
    return runner.rankScore;
  }
  const skillIds = runner.skills.map((id) => id.split('-', 1)[0] ?? id);
  const merged: RankScoreOptions = {
    star: runner.star ?? options?.star,
    uniqueLevel: options?.uniqueLevel,
    uniqueLevels: runner.skillLevels ?? options?.uniqueLevels
  };
  return computeRankScore(
    [runner.speed, runner.stamina, runner.power, runner.guts, runner.wisdom],
    runnerAptitudes(runner),
    skillIds,
    merged
  );
}
