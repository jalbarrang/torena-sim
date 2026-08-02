import type { IStrategyName } from '@/lib/uma-domain/runner/definitions';
import { Strategy, StrategyName } from '@/lib/uma-domain/runner/definitions';
import type { IRunnerState, RunnerAptitudes } from '../components/runner-card/domain/runner-state';
import { buildDecodedRunner } from '../roster/helpers';
import type { IDecodedRunner } from '../roster/types';
import type { ISingleExportData, ISingleExportSkill } from '../share/types';

const REQUIRED_NUMBER_FIELDS = ['card_id', 'speed', 'stamina', 'power', 'guts', 'wiz'] as const;

const APTITUDE_FIELDS = [
  'proper_distance_short',
  'proper_distance_mile',
  'proper_distance_middle',
  'proper_distance_long',
  'proper_ground_turf',
  'proper_ground_dirt',
  'proper_running_style_nige',
  'proper_running_style_senko',
  'proper_running_style_sashi',
  'proper_running_style_oikomi'
] as const;

const STRATEGY_BY_RUNNING_STYLE: Partial<Record<number, IStrategyName>> = {
  [Strategy.FrontRunner]: StrategyName[Strategy.FrontRunner],
  [Strategy.PaceChaser]: StrategyName[Strategy.PaceChaser],
  [Strategy.LateSurger]: StrategyName[Strategy.LateSurger],
  [Strategy.EndCloser]: StrategyName[Strategy.EndCloser],
  [Strategy.Runaway]: StrategyName[Strategy.Runaway]
};

type UmadumpDecodedRunner = IDecodedRunner & {
  importNotes: string;
};

export type ParseUmadumpResult =
  | {
      ok: true;
      runners: UmadumpDecodedRunner[];
      skippedEntries: number;
      skippedSkills: number;
    }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isNonNegativeInteger(value) && value > 0;
}

function hasValidCoreFields(entry: Record<string, unknown>): boolean {
  for (const key of REQUIRED_NUMBER_FIELDS) {
    const value = entry[key];
    if (!isNonNegativeInteger(value) || (key === 'card_id' && value === 0)) return false;
  }

  for (const key of APTITUDE_FIELDS) {
    const value = entry[key];
    if (!isPositiveInteger(value) || value > 8) return false;
  }

  return Array.isArray(entry.skill_array);
}

function normalizeSkills(value: unknown[]): { skills: ISingleExportSkill[]; skipped: number } {
  const byId = new Map<number, ISingleExportSkill>();
  let skipped = 0;

  for (const rawSkill of value) {
    if (!isRecord(rawSkill) || !isPositiveInteger(rawSkill.skill_id)) {
      skipped++;
      continue;
    }

    const rawLevel = rawSkill.level ?? rawSkill.skill_level;
    if (!isPositiveInteger(rawLevel)) {
      skipped++;
      continue;
    }

    byId.set(rawSkill.skill_id, {
      skill_id: rawSkill.skill_id,
      skill_level: rawLevel
    });
  }

  return { skills: [...byId.values()], skipped };
}

function optionalInteger(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    return undefined;
  }
  return value;
}

function toDecodedRunner(entry: Record<string, unknown>, skills: ISingleExportSkill[]) {
  const source: ISingleExportData = {
    card_id: entry.card_id as number,
    speed: entry.speed as number,
    stamina: entry.stamina as number,
    power: entry.power as number,
    guts: entry.guts as number,
    wiz: entry.wiz as number,
    proper_distance_short: entry.proper_distance_short as number,
    proper_distance_mile: entry.proper_distance_mile as number,
    proper_distance_middle: entry.proper_distance_middle as number,
    proper_distance_long: entry.proper_distance_long as number,
    proper_ground_turf: entry.proper_ground_turf as number,
    proper_ground_dirt: entry.proper_ground_dirt as number,
    proper_running_style_nige: entry.proper_running_style_nige as number,
    proper_running_style_senko: entry.proper_running_style_senko as number,
    proper_running_style_sashi: entry.proper_running_style_sashi as number,
    proper_running_style_oikomi: entry.proper_running_style_oikomi as number,
    create_time: typeof entry.create_time === 'string' ? entry.create_time : '',
    rank_score: optionalInteger(entry.rank_score, 0, Number.MAX_SAFE_INTEGER),
    skill_array: skills
  };

  const decoded = buildDecodedRunner(source);
  const runningStyle = optionalInteger(entry.running_style, 1, 5);
  const talentLevel = optionalInteger(entry.talent_level, 1, 5);
  const memo = typeof entry.memo === 'string' ? entry.memo.trim() : '';

  return {
    ...decoded,
    state: {
      ...decoded.state,
      strategy:
        (runningStyle === undefined ? undefined : STRATEGY_BY_RUNNING_STYLE[runningStyle]) ??
        StrategyName[Strategy.FrontRunner],
      rankScore: source.rank_score ?? null,
      star: talentLevel ?? null
    },
    importNotes: memo || 'Imported from umadump'
  } satisfies UmadumpDecodedRunner;
}

export function parseUmadumpTrainedCharaJson(raw: string): ParseUmadumpResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      error: 'This file is not valid JSON. Choose the trained_chara_data.json file from umadump.'
    };
  }

  if (!Array.isArray(parsed)) {
    return {
      ok: false,
      error: 'This is not an umadump trained-character file. Expected a JSON array.'
    };
  }

  const runners: UmadumpDecodedRunner[] = [];
  let skippedEntries = 0;
  let skippedSkills = 0;

  for (const entry of parsed) {
    if (!isRecord(entry) || !hasValidCoreFields(entry)) {
      skippedEntries++;
      continue;
    }

    const normalized = normalizeSkills(entry.skill_array as unknown[]);
    skippedSkills += normalized.skipped;
    runners.push(toDecodedRunner(entry, normalized.skills));
  }

  if (runners.length === 0) {
    return {
      ok: false,
      error:
        parsed.length === 0
          ? 'This umadump file contains no trained characters.'
          : 'No usable trained characters were found. Check that this is trained_chara_data.json.'
    };
  }

  return { ok: true, runners, skippedEntries, skippedSkills };
}

function expandedAptitudes(runner: IRunnerState): RunnerAptitudes {
  return (
    runner.aptitudes ?? {
      distanceShort: runner.distanceAptitude,
      distanceMile: runner.distanceAptitude,
      distanceMiddle: runner.distanceAptitude,
      distanceLong: runner.distanceAptitude,
      turf: runner.surfaceAptitude,
      dirt: runner.surfaceAptitude,
      nige: runner.strategyAptitude,
      senko: runner.strategyAptitude,
      sashi: runner.strategyAptitude,
      oikomi: runner.strategyAptitude
    }
  );
}

/** Stable identity for one functional Veteran build; notes and local library metadata are excluded. */
export function veteranBuildFingerprint(runner: IRunnerState): string {
  const skills = [...new Set(runner.skills)]
    .sort((left, right) => left.localeCompare(right))
    .map((skillId) => [skillId, runner.skillLevels?.[skillId] ?? 1]);

  return JSON.stringify({
    outfitId: runner.outfitId,
    stats: [runner.speed, runner.stamina, runner.power, runner.guts, runner.wisdom],
    strategy: runner.strategy,
    aptitudes: expandedAptitudes(runner),
    rankScore: runner.rankScore ?? null,
    star: runner.star ?? null,
    skills
  });
}
