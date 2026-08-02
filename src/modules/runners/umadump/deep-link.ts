import { BitVector } from '../share/bit-vector';
import { parseUmadumpTrainedCharaJson, type ParseUmadumpResult } from './parser';

export const UMADUMP_IMPORT_PARAM = 'from';
export const UMADUMP_DEEP_LINK_MAX_VALUE_LENGTH = 15_000;

const MAGIC = 0x5544; // ASCII "UD"
const VERSION = 1;
const MAX_20_BIT_VALUE = 0x0f_ffff;
const MAX_VETERANS = 0xff_ff;
const MAX_SKILLS = 0xff;
const MAX_MEMO_BYTES = 0xff_ff;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

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

const STAT_FIELDS = ['speed', 'stamina', 'power', 'guts', 'wiz'] as const;

type UmadumpEntry = Record<string, unknown>;

function linkError(message: string): ParseUmadumpResult {
  return { ok: false, error: message };
}

function isRecord(value: unknown): value is UmadumpEntry {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireInteger(entry: UmadumpEntry, key: string, min: number, max: number): number {
  const value = entry[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${key} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function optionalInteger(
  entry: UmadumpEntry,
  key: string,
  min: number,
  max: number
): number | null {
  if (entry[key] == null) return null;
  return requireInteger(entry, key, min, max);
}

function readBits(vector: BitVector, length: number): number {
  if (vector.bitsRemaining() < length) throw new RangeError('truncated payload');
  return vector.read(length);
}

function readUtf8(vector: BitVector, length: number): string {
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index++) bytes[index] = readBits(vector, 8);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function writeEntry(vector: BitVector, entry: UmadumpEntry): void {
  vector.write(requireInteger(entry, 'card_id', 1, MAX_20_BIT_VALUE), 20);

  for (const field of STAT_FIELDS) {
    vector.write(requireInteger(entry, field, 0, 2047), 11);
  }

  for (const field of APTITUDE_FIELDS) {
    vector.write(requireInteger(entry, field, 1, 8) - 1, 3);
  }

  vector.write(optionalInteger(entry, 'running_style', 1, 5) ?? 0, 3);

  const rankScore = optionalInteger(entry, 'rank_score', 0, MAX_20_BIT_VALUE);
  vector.write(rankScore === null ? 0 : 1, 1);
  if (rankScore !== null) vector.write(rankScore, 20);

  vector.write(optionalInteger(entry, 'talent_level', 1, 5) ?? 0, 3);

  if (!Array.isArray(entry.skill_array) || entry.skill_array.length > MAX_SKILLS) {
    throw new RangeError(`skill_array must contain at most ${MAX_SKILLS} skills`);
  }
  vector.write(entry.skill_array.length, 8);
  for (const rawSkill of entry.skill_array) {
    if (!isRecord(rawSkill)) throw new TypeError('skill_array entries must be objects');
    vector.write(requireInteger(rawSkill, 'skill_id', 1, MAX_20_BIT_VALUE), 20);
    const levelKey = rawSkill.level == null ? 'skill_level' : 'level';
    vector.write(requireInteger(rawSkill, levelKey, 1, 7), 3);
  }

  const memo = typeof entry.memo === 'string' ? entry.memo : '';
  const memoBytes = new TextEncoder().encode(memo);
  if (memoBytes.length > MAX_MEMO_BYTES) {
    throw new RangeError(`memo must be at most ${MAX_MEMO_BYTES} UTF-8 bytes`);
  }
  vector.write(memoBytes.length, 16);
  for (const byte of memoBytes) vector.write(byte, 8);
}

function readEntry(vector: BitVector): UmadumpEntry {
  const entry: UmadumpEntry = {
    card_id: readBits(vector, 20),
    speed: readBits(vector, 11),
    stamina: readBits(vector, 11),
    power: readBits(vector, 11),
    guts: readBits(vector, 11),
    wiz: readBits(vector, 11)
  };

  for (const field of APTITUDE_FIELDS) entry[field] = readBits(vector, 3) + 1;

  const runningStyle = readBits(vector, 3);
  if (runningStyle > 5) throw new RangeError('reserved running_style');
  if (runningStyle > 0) entry.running_style = runningStyle;

  if (readBits(vector, 1) === 1) entry.rank_score = readBits(vector, 20);

  const talentLevel = readBits(vector, 3);
  if (talentLevel > 5) throw new RangeError('reserved talent_level');
  if (talentLevel > 0) entry.talent_level = talentLevel;

  const skillCount = readBits(vector, 8);
  entry.skill_array = Array.from({ length: skillCount }, () => {
    const skillId = readBits(vector, 20);
    const level = readBits(vector, 3);
    if (skillId === 0 || level === 0) throw new RangeError('reserved skill value');
    return { skill_id: skillId, level };
  });

  entry.memo = readUtf8(vector, readBits(vector, 16));
  return entry;
}

function decodeEntries(value: string): UmadumpEntry[] {
  if (!BASE64URL_PATTERN.test(value)) throw new TypeError('invalid base64url');

  const vector = BitVector.fromBase64(value);
  if (readBits(vector, 16) !== MAGIC) throw new TypeError('unsupported magic');

  const version = readBits(vector, 8);
  if (version !== VERSION) throw new TypeError(`unsupported version:${version}`);

  const count = readBits(vector, 16);
  const entries = Array.from({ length: count }, () => readEntry(vector));

  const paddingLength = vector.bitsRemaining();
  if (paddingLength > 5 || (paddingLength > 0 && readBits(vector, paddingLength) !== 0)) {
    throw new RangeError('invalid trailing data');
  }
  return entries;
}

/** Decode the versioned umadump BitVector and validate it with the normal JSON parser. */
export function decodeUmadumpDeepLinkValue(value: string): ParseUmadumpResult {
  if (!value) {
    return linkError(
      'This umadump import link has an empty payload. Generate a new link or import trained_chara_data.json instead.'
    );
  }

  if (value.length > UMADUMP_DEEP_LINK_MAX_VALUE_LENGTH) {
    return linkError(
      'This umadump import link is too long for reliable browser support. Import trained_chara_data.json instead.'
    );
  }

  let entries: UmadumpEntry[];
  try {
    entries = decodeEntries(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.startsWith('unsupported version:')) {
      return linkError(
        `This umadump import link uses unsupported version “${message.slice(message.indexOf(':') + 1)}”. Update umadump or import trained_chara_data.json instead.`
      );
    }
    if (message === 'unsupported magic') {
      return linkError(
        'This umadump import link has an unsupported format. Update umadump or import trained_chara_data.json instead.'
      );
    }
    return linkError(
      'This umadump import link has a malformed or truncated payload. Copy the complete link or import trained_chara_data.json instead.'
    );
  }

  const parsed = parseUmadumpTrainedCharaJson(JSON.stringify(entries));
  if (parsed.ok) return parsed;
  return linkError(
    `Invalid umadump import link. ${parsed.error} Generate a new link or import trained_chara_data.json instead.`
  );
}

/** Encode the Torena-imported projection of trained_chara_data.json as a BitVector. */
export function encodeUmadumpDeepLinkValue(rawJson: string): string {
  const parsed: unknown = JSON.parse(rawJson);
  if (!Array.isArray(parsed) || parsed.length > MAX_VETERANS) {
    throw new RangeError(`trained character data must contain at most ${MAX_VETERANS} entries`);
  }

  const vector = new BitVector();
  vector.write(MAGIC, 16);
  vector.write(VERSION, 8);
  vector.write(parsed.length, 16);
  for (const entry of parsed) {
    if (!isRecord(entry)) throw new TypeError('trained character entries must be objects');
    writeEntry(vector, entry);
  }

  const value = vector.toBase64();
  if (value.length > UMADUMP_DEEP_LINK_MAX_VALUE_LENGTH) {
    throw new RangeError('encoded payload exceeds the browser-safe URL limit');
  }
  return value;
}
