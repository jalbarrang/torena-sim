import type {
  IRunnerState,
  RunnerAptitudes
} from '@/modules/runners/components/runner-card/domain/runner-state';
import type { UmaAptitudes } from '@/modules/data/services/UmaService';
import { coursesService } from '@/modules/data/services/CourseService';

export type AptitudeBucketKey = keyof RunnerAptitudes;

/** Map an outfit's innate aptitudes onto the 10-bucket runner aptitude shape. */
export function aptitudesFromInnate(innate: UmaAptitudes): RunnerAptitudes {
  return {
    turf: innate.turf,
    dirt: innate.dirt,
    distanceShort: innate.sprint,
    distanceMile: innate.mile,
    distanceMiddle: innate.medium,
    distanceLong: innate.long,
    nige: innate.frontRunner,
    senko: innate.paceChaser,
    sashi: innate.lateSurger,
    oikomi: innate.endCloser
  };
}

export const DISTANCE_BUCKETS: ReadonlyArray<{ key: AptitudeBucketKey; label: string }> = [
  { key: 'distanceShort', label: 'Sprint' },
  { key: 'distanceMile', label: 'Mile' },
  { key: 'distanceMiddle', label: 'Medium' },
  { key: 'distanceLong', label: 'Long' }
];

export const SURFACE_BUCKETS: ReadonlyArray<{ key: AptitudeBucketKey; label: string }> = [
  { key: 'turf', label: 'Turf' },
  { key: 'dirt', label: 'Dirt' }
];

export const STYLE_BUCKETS: ReadonlyArray<{ key: AptitudeBucketKey; label: string }> = [
  { key: 'nige', label: 'Front' },
  { key: 'senko', label: 'Pace' },
  { key: 'sashi', label: 'Late' },
  { key: 'oikomi', label: 'End' }
];

const VALID_GRADES = new Set(['S', 'A', 'B', 'C', 'D', 'E', 'F', 'G']);
const GRADE_RANK = ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'G'];

function isValidGrade(value: unknown): value is string {
  return typeof value === 'string' && VALID_GRADES.has(value);
}

/** Best (highest) valid grade among the candidates, else undefined. */
function bestGrade(...grades: unknown[]): string | undefined {
  let best: string | undefined;
  for (const grade of grades) {
    if (!isValidGrade(grade)) continue;
    if (best === undefined || GRADE_RANK.indexOf(grade) < GRADE_RANK.indexOf(best)) {
      best = grade;
    }
  }
  return best;
}

/**
 * Full bucket set. When `aptitudes` is present, any missing/invalid bucket is
 * backfilled from its valid siblings (then the collapsed grade, then 'G') so the
 * UI and scoring never see a blank grade. Without `aptitudes`, the collapsed
 * grades are broadcast across each axis.
 */
export function bucketsFromRunner(runner: IRunnerState): RunnerAptitudes {
  const d = runner.distanceAptitude;
  const s = runner.surfaceAptitude;
  const st = runner.strategyAptitude;

  if (!runner.aptitudes) {
    return {
      distanceShort: d,
      distanceMile: d,
      distanceMiddle: d,
      distanceLong: d,
      turf: s,
      dirt: s,
      nige: st,
      senko: st,
      sashi: st,
      oikomi: st
    };
  }

  const a = runner.aptitudes;
  const distanceFallback =
    bestGrade(a.distanceShort, a.distanceMile, a.distanceMiddle, a.distanceLong, d) ?? 'G';
  const surfaceFallback = bestGrade(a.turf, a.dirt, s) ?? 'G';
  const styleFallback = bestGrade(a.nige, a.senko, a.sashi, a.oikomi, st) ?? 'G';
  const fix = (value: unknown, fallback: string) => (isValidGrade(value) ? value : fallback);

  return {
    distanceShort: fix(a.distanceShort, distanceFallback),
    distanceMile: fix(a.distanceMile, distanceFallback),
    distanceMiddle: fix(a.distanceMiddle, distanceFallback),
    distanceLong: fix(a.distanceLong, distanceFallback),
    turf: fix(a.turf, surfaceFallback),
    dirt: fix(a.dirt, surfaceFallback),
    nige: fix(a.nige, styleFallback),
    senko: fix(a.senko, styleFallback),
    sashi: fix(a.sashi, styleFallback),
    oikomi: fix(a.oikomi, styleFallback)
  };
}

function distanceCategory(distance: number): 1 | 2 | 3 | 4 {
  if (distance <= 1400) return 1;
  if (distance <= 1800) return 2;
  if (distance <= 2400) return 3;
  return 4;
}

const DISTANCE_KEY_BY_CATEGORY: Record<number, AptitudeBucketKey> = {
  1: 'distanceShort',
  2: 'distanceMile',
  3: 'distanceMiddle',
  4: 'distanceLong'
};

const STYLE_KEY_BY_STRATEGY: Record<string, AptitudeBucketKey> = {
  'Front Runner': 'nige',
  Runaway: 'nige',
  'Pace Chaser': 'senko',
  'Late Surger': 'sashi',
  'End Closer': 'oikomi'
};

/**
 * Pick the three collapsed grades (engine input) that match a given course +
 * strategy from a full bucket set. Keeps the sim/coarse view consistent with the
 * per-bucket values for the race actually being run.
 */
export function collapsedForCourse(
  aptitudes: RunnerAptitudes,
  courseId: number,
  strategy: IRunnerState['strategy']
): Pick<IRunnerState, 'distanceAptitude' | 'surfaceAptitude' | 'strategyAptitude'> {
  const course = coursesService.getById(String(courseId));
  const distanceKey = course
    ? DISTANCE_KEY_BY_CATEGORY[distanceCategory(course.distance)]
    : 'distanceMiddle';
  const surfaceKey: AptitudeBucketKey = course?.surface === 2 ? 'dirt' : 'turf';
  const styleKey = STYLE_KEY_BY_STRATEGY[strategy] ?? 'nige';
  return {
    distanceAptitude: aptitudes[distanceKey],
    surfaceAptitude: aptitudes[surfaceKey],
    strategyAptitude: aptitudes[styleKey]
  };
}

const GRADE_ORDER = ['G', 'F', 'E', 'D', 'C', 'B', 'A', 'S'];

function maxGrade(grades: string[]): string {
  return grades.reduce(
    (best, grade) => (GRADE_ORDER.indexOf(grade) > GRADE_ORDER.indexOf(best) ? grade : best),
    grades[0] ?? 'G'
  );
}

/**
 * Collapse buckets without a course: distance/surface use the best (max) grade,
 * style uses the bucket matching the strategy. Used where there is no race
 * (e.g. the Veteran library).
 */
function collapsedMax(
  aptitudes: RunnerAptitudes,
  strategy: IRunnerState['strategy']
): Pick<IRunnerState, 'distanceAptitude' | 'surfaceAptitude' | 'strategyAptitude'> {
  const styleKey = STYLE_KEY_BY_STRATEGY[strategy] ?? 'nige';
  return {
    distanceAptitude: maxGrade([
      aptitudes.distanceShort,
      aptitudes.distanceMile,
      aptitudes.distanceMiddle,
      aptitudes.distanceLong
    ]),
    surfaceAptitude: maxGrade([aptitudes.turf, aptitudes.dirt]),
    strategyAptitude: aptitudes[styleKey]
  };
}

/** Resolve collapsed grades: course-aware when courseId is given, else max. */
export function collapsedFromBuckets(
  aptitudes: RunnerAptitudes,
  strategy: IRunnerState['strategy'],
  courseId?: number
): Pick<IRunnerState, 'distanceAptitude' | 'surfaceAptitude' | 'strategyAptitude'> {
  return courseId !== undefined
    ? collapsedForCourse(aptitudes, courseId, strategy)
    : collapsedMax(aptitudes, strategy);
}
