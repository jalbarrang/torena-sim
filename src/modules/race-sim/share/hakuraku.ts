import { Mood, Strategy, StrategyName } from '@/lib/uma-domain/runner/definitions';
import type { IMood, IStrategyName } from '@/lib/uma-domain/runner/definitions';
import { createRunnerState } from '@/modules/runners/components/runner-card/domain/runner-state';
import type { IRunnerState } from '@/modules/runners/components/runner-card/domain/runner-state';
import { singleExportToRunnerState } from '@/modules/runners/share/converters';
import type { ISingleExportData, ISingleExportSkill } from '@/modules/runners/share/types';
import type { RaceConditions } from '@/utils/races';
import { createRaceConditions } from '@/utils/races';
import type { RaceSimSnapshot } from './types';
import { RACE_SIM_SNAPSHOT_VERSION } from './types';

type HakurakuParseOptions = {
  /** Used when the race file does not carry a course id. */
  fallbackCourseId?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function firstFiniteNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** Normalize horseACT skill_array entries (numbers, {skill_id}, or {skillId}). */
function normalizeSkillArray(skills: unknown): ISingleExportSkill[] {
  if (!Array.isArray(skills)) return [];
  return skills
    .map((skill): ISingleExportSkill | null => {
      if (typeof skill === 'number') {
        return Number.isFinite(skill) && skill > 0 ? { skill_id: skill, skill_level: 1 } : null;
      }
      if (!isRecord(skill)) return null;
      const skillId = Number(skill.skill_id ?? skill.skillId);
      if (!Number.isFinite(skillId) || skillId <= 0) return null;
      const level = Number(skill.skill_level ?? skill.level);
      return { skill_id: skillId, skill_level: Number.isFinite(level) && level > 0 ? level : 1 };
    })
    .filter((skill): skill is ISingleExportSkill => skill !== null);
}

const STRATEGY_BY_RUNNING_STYLE: Record<number, IStrategyName> = {
  [Strategy.FrontRunner]: StrategyName[Strategy.FrontRunner],
  [Strategy.PaceChaser]: StrategyName[Strategy.PaceChaser],
  [Strategy.LateSurger]: StrategyName[Strategy.LateSurger],
  [Strategy.EndCloser]: StrategyName[Strategy.EndCloser],
  [Strategy.Runaway]: StrategyName[Strategy.Runaway]
};

/** Coerce one raw horse object into an ISingleExportData for reuse of converters. */
function horseToSingleExport(horse: Record<string, unknown>): ISingleExportData | null {
  const cardId = firstFiniteNumber(horse.card_id, horse.cardId);
  if (cardId === undefined) return null;

  // Compact race dumps carry a single grade per axis (apt_distance/apt_ground/apt_style);
  // full dumps carry per-bucket proper_* values. Prefer proper_*, fall back to the compact
  // grade, then default to 1 (G). singleExportToRunnerState takes the max per axis, so filling
  // every bucket with the compact grade yields the correct single aptitude.
  const aptDistance = firstFiniteNumber(horse.apt_distance) ?? 1;
  const aptGround = firstFiniteNumber(horse.apt_ground) ?? 1;
  const aptStyle = firstFiniteNumber(horse.apt_style) ?? 1;
  const apt = (key: string, fallback: number): number => firstFiniteNumber(horse[key]) ?? fallback;

  return {
    card_id: cardId,
    speed: toNumber(horse.speed),
    stamina: toNumber(horse.stamina),
    power: toNumber(horse.power ?? horse.pow),
    guts: toNumber(horse.guts),
    wiz: toNumber(horse.wiz ?? horse.wisdom),
    proper_distance_short: apt('proper_distance_short', aptDistance),
    proper_distance_mile: apt('proper_distance_mile', aptDistance),
    proper_distance_middle: apt('proper_distance_middle', aptDistance),
    proper_distance_long: apt('proper_distance_long', aptDistance),
    proper_ground_turf: apt('proper_ground_turf', aptGround),
    proper_ground_dirt: apt('proper_ground_dirt', aptGround),
    proper_running_style_nige: apt('proper_running_style_nige', aptStyle),
    proper_running_style_senko: apt('proper_running_style_senko', aptStyle),
    proper_running_style_sashi: apt('proper_running_style_sashi', aptStyle),
    proper_running_style_oikomi: apt('proper_running_style_oikomi', aptStyle),
    create_time: '',
    skill_array: normalizeSkillArray(horse.skill_array)
  };
}

/** Game motivation is 1 (Awful) .. 5 (Great); our Mood enum is -2 .. 2. */
function motivationToMood(value: unknown): IMood | undefined {
  const n = firstFiniteNumber(value);
  if (n === undefined) return undefined;
  return Math.max(Mood.Awful, Math.min(Mood.Great, n - 3)) as IMood;
}

function horseToRunner(horse: Record<string, unknown>): IRunnerState | null {
  const single = horseToSingleExport(horse);
  if (single === null) return null;

  const runningStyle = firstFiniteNumber(horse.running_style, horse.runningStyle);
  const strategy = runningStyle !== undefined ? STRATEGY_BY_RUNNING_STYLE[runningStyle] : undefined;

  return createRunnerState({
    ...singleExportToRunnerState(single),
    strategy: strategy ?? StrategyName[Strategy.FrontRunner],
    mood: motivationToMood(horse.motivation) ?? Mood.Normal,
    team: firstFiniteNumber(horse.team_id) ?? null,
    // frame_order is the 1-based post position.
    gate: firstFiniteNumber(horse.frame_order) ?? null,
    rankScore: firstFiniteNumber(horse.rank_score) ?? null,
    // Mark as imported so UI can hide controls that don't apply to opponents
    // copied from a real race (e.g. the star rating).
    imported: true,
    // Compact race files carry no per-skill levels; leave unset rather than
    // implying level 1 (rank score is imported directly anyway).
    skillLevels: undefined
  });
}

/** Map a horseACT season value (5 = Sakura) onto our Season enum, mirroring Hakuraku. */
function normalizeSeason(value: unknown): number | undefined {
  const n = firstFiniteNumber(value);
  if (n === undefined) return undefined;
  return n === 5 ? 1 : n;
}

type ExtractedRace = {
  horses: Record<string, unknown>[];
  courseId?: number;
  conditions: Partial<RaceConditions>;
};

function extractRace(json: Record<string, unknown>): ExtractedRace | null {
  // Hakuraku replay API payload: { race: {...}, replay: { raceHorseDataArray: [...] } }
  if (isRecord(json.replay) && Array.isArray(json.replay.raceHorseDataArray)) {
    const replay = json.replay;
    const race = isRecord(json.race) ? json.race : {};
    const horses = (replay.raceHorseDataArray as unknown[]).filter(isRecord);
    return {
      horses,
      courseId: firstFiniteNumber(race.courseId, race.course_id),
      conditions: {
        ground: firstFiniteNumber(race.groundCondition, race.ground_condition),
        weather: firstFiniteNumber(race.weather),
        season: normalizeSeason(race.season)
      } as Partial<RaceConditions>
    };
  }

  // New format: race_horse_data_array
  if (Array.isArray(json.race_horse_data_array)) {
    const horses = json.race_horse_data_array.filter(isRecord);
    const courseSet = isRecord(json.race_course_set) ? json.race_course_set : undefined;
    const courseId = firstFiniteNumber(courseSet?.id, courseSet?.Id, json.course_id);
    return {
      horses,
      courseId,
      conditions: {
        ground: firstFiniteNumber(json.ground_condition),
        weather: firstFiniteNumber(json.weather),
        season: normalizeSeason(json.season),
        time: firstFiniteNumber(json.race_time, json.time)
      } as Partial<RaceConditions>
    };
  }

  // Legacy format: <RaceHorse>k__BackingField with _responseHorseData
  const raceHorse = json['<RaceHorse>k__BackingField'];
  if (Array.isArray(raceHorse)) {
    const horses = raceHorse
      .map((member) =>
        isRecord(member) && isRecord(member._responseHorseData) ? member._responseHorseData : null
      )
      .filter((h): h is Record<string, unknown> => h !== null);

    const courseSet = isRecord(json['<RaceCourseSet>k__BackingField'])
      ? (json['<RaceCourseSet>k__BackingField'] as Record<string, unknown>)
      : undefined;
    const courseId = firstFiniteNumber(courseSet?.['<Id>k__BackingField'], courseSet?.Id);

    return {
      horses,
      courseId,
      conditions: {
        ground: firstFiniteNumber(json['<GroundCondition>k__BackingField']),
        weather: firstFiniteNumber(json['<Weather>k__BackingField']),
        season: normalizeSeason(json['<Season>k__BackingField'])
      } as Partial<RaceConditions>
    };
  }

  return null;
}

/**
 * Detects the decoded race-replay shape (RaceSimulateData: frames/results/events).
 * That export carries no runner configuration, so it cannot become a snapshot.
 */
export function isHakurakuReplayData(raw: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!isRecord(parsed)) return false;
  return (
    typeof parsed.horseNum === 'number' &&
    Array.isArray(parsed.frame) &&
    Array.isArray(parsed.horseResult)
  );
}

export function parseHakurakuRaceJson(
  raw: string,
  options: HakurakuParseOptions = {}
): RaceSimSnapshot | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;

  const race = extractRace(parsed);
  if (race === null || race.horses.length === 0) return null;

  const runners = race.horses
    .map(horseToRunner)
    .filter((runner): runner is IRunnerState => runner !== null);

  if (runners.length === 0) return null;

  const courseId = race.courseId ?? options.fallbackCourseId;
  if (courseId === undefined) return null;

  // Drop undefined keys so createRaceConditions defaults fill the gaps.
  const conditionEntries = Object.entries(race.conditions).filter(
    ([, value]) => value !== undefined
  );
  const racedef = createRaceConditions(Object.fromEntries(conditionEntries));

  return {
    version: RACE_SIM_SNAPSHOT_VERSION,
    timestamp: Date.now(),
    runners,
    courseId,
    racedef,
    nsamples: 1,
    seed: null,
    focusRunnerIndices: []
  };
}
