#!/usr/bin/env node
/**
 * Generate the bundled Champions Meeting presets from GameTora's JP event catalog.
 *
 * Source: `events/champions-meeting` in GameTora's Umamusume data manifest.
 * Existing preset IDs are preserved so regenerating does not invalidate persisted user data.
 * Events whose courses are not yet available in our extracted course data are skipped.
 */

import { createHash } from 'node:crypto';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { loadManifest, loadManifestData } from './data-extract/gametora-client';
import { readJsonFile } from './master-data/shared';

const ROOT = path.resolve(import.meta.dirname, '..');
const GAMETORA_CM_KEY = 'events/champions-meeting';
const FIRST_BUNDLED_CM_ID = 11;
const EVENT_TYPE_CM = 0;
const TIME_OF_DAY_MIDDAY = 2;

type RawRace = {
  condition: number;
  distance: number;
  ground: number;
  season: number;
  track: number;
  turn: number;
  weather: number;
};

type RawCmPreset = {
  id: number;
  name: string;
  name_en?: string;
  race: RawRace;
  start: number;
};

type CourseRow = {
  raceTrackId: number;
  distance: number;
  surface: number;
  turn: number;
};

type RacePresetOut = {
  id: string;
  name: string;
  type: number;
  date: string;
  courseId: number;
  season: number;
  ground: number;
  weather: number;
  time: number;
};

type SkippedPreset = {
  sourceId: number;
  name: string;
  reason: string;
};

type TransformResult = {
  presets: RacePresetOut[];
  skipped: SkippedPreset[];
};

function formatDateFromUnixSeconds(sec: number): string {
  return new Date(sec * 1000).toISOString().slice(0, 10);
}

function presetIdentity(name: string, date: string): string {
  return `${date}\0${name}`;
}

function deterministicPresetId(sourceId: number): string {
  const bytes = createHash('sha256').update(`gametora-jp-champions-meeting:${sourceId}`).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function findCourseId(
  courses: Record<string, CourseRow>,
  track: number,
  distance: number,
  turn: number,
  surface: number
): { courseId: number | null; reason: string } {
  const matches = Object.entries(courses).filter(
    ([, course]) =>
      course.raceTrackId === track &&
      course.distance === distance &&
      course.turn === turn &&
      course.surface === surface
  );

  if (matches.length === 0) {
    return {
      courseId: null,
      reason: `no course for track=${track} distance=${distance} turn=${turn} surface=${surface}`
    };
  }

  if (matches.length > 1) {
    console.warn(
      `Ambiguous course match (using first): ${matches.map(([id]) => id).join(', ')} for track=${track} distance=${distance} turn=${turn} surface=${surface}`
    );
  }

  return { courseId: Number(matches[0][0]), reason: '' };
}

function transformPresets(
  rawPresets: RawCmPreset[],
  courses: Record<string, CourseRow>,
  existingPresets: RacePresetOut[]
): TransformResult {
  const existingIds = new Map(
    existingPresets.map((preset) => [presetIdentity(preset.name, preset.date), preset.id])
  );
  const presets: RacePresetOut[] = [];
  const skipped: SkippedPreset[] = [];

  for (const source of rawPresets.filter((preset) => preset.id >= FIRST_BUNDLED_CM_ID)) {
    const race = source.race;
    const name = source.name_en ?? source.name;
    const date = formatDateFromUnixSeconds(source.start);
    const { courseId, reason } = findCourseId(
      courses,
      race.track,
      race.distance,
      race.turn,
      race.ground
    );

    if (courseId === null) {
      skipped.push({ sourceId: source.id, name, reason });
      continue;
    }

    presets.push({
      id: existingIds.get(presetIdentity(name, date)) ?? deterministicPresetId(source.id),
      name,
      type: EVENT_TYPE_CM,
      date,
      courseId,
      season: race.season,
      ground: race.condition,
      weather: race.weather,
      time: TIME_OF_DAY_MIDDAY
    });
  }

  return { presets, skipped };
}

async function main(): Promise<void> {
  const presetsPath = path.join(ROOT, 'src', 'store', 'race', 'cm-presets.json');
  const coursePath = path.join(ROOT, 'src', 'modules', 'data', 'json', 'course_data.json');

  const [manifest, courses, existingPresets] = await Promise.all([
    loadManifest(),
    readJsonFile<Record<string, CourseRow>>(coursePath),
    readJsonFile<RacePresetOut[]>(presetsPath)
  ]);
  const rawPresets = await loadManifestData<RawCmPreset[]>(manifest, GAMETORA_CM_KEY);
  if (rawPresets === null) {
    throw new Error(`GameTora manifest is missing ${GAMETORA_CM_KEY}`);
  }

  const { presets, skipped } = transformPresets(rawPresets, courses, existingPresets);
  for (const preset of skipped) {
    console.warn(`SKIP source id=${preset.sourceId} name=${preset.name}: ${preset.reason}`);
  }

  await writeFile(presetsPath, `${JSON.stringify(presets, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${presets.length} presets to ${presetsPath} (skipped ${skipped.length})`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { deterministicPresetId, findCourseId, transformPresets };
export type { CourseRow, RacePresetOut, RawCmPreset, TransformResult };
