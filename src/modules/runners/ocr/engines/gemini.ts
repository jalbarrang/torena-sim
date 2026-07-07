import type { IStrategyName } from '@/lib/uma-domain/runner/definitions';
import { skillsService } from '@/modules/data/services/SkillService';
import { findBestUmaMatch } from '@/modules/runners/data/search';
import type { OcrEngine, OcrEngineResult } from '@/modules/runners/ocr/engine';
import type { ExtractedSkill, ExtractedUmaData } from '@/modules/runners/ocr/types';

interface GeminiStructuredResponse {
  name: string;
  outfit: string;
  speed: number;
  stamina: number;
  power: number;
  guts: number;
  wisdom: number;
  surfaceAptitude: string;
  distanceAptitude: string;
  strategyAptitude: string;
  strategy: string;
  skills: Array<string>;
}

const STRATEGY_NAME_MAP: Record<string, IStrategyName> = {
  nige: 'Front Runner',
  front: 'Front Runner',
  'front runner': 'Front Runner',
  senkou: 'Pace Chaser',
  pace: 'Pace Chaser',
  'pace chaser': 'Pace Chaser',
  sasi: 'Late Surger',
  sashi: 'Late Surger',
  late: 'Late Surger',
  'late surger': 'Late Surger',
  oikomi: 'End Closer',
  end: 'End Closer',
  'end closer': 'End Closer',
  runaway: 'Runaway'
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stripMarkdownFences(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);

  return match?.[1]?.trim() ?? trimmed;
}

function parseStringField(
  payload: Record<string, unknown>,
  key: keyof GeminiStructuredResponse
): string {
  const value = payload[key];

  if (typeof value !== 'string') {
    throw new TypeError(`Gemini JSON is missing a valid "${key}" string`);
  }

  return value.trim();
}

function parseNumberField(
  payload: Record<string, unknown>,
  key: keyof GeminiStructuredResponse
): number {
  const value = payload[key];

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  throw new Error(`Gemini JSON is missing a valid numeric "${key}" value`);
}

function parseGradeField(
  payload: Record<string, unknown>,
  key: keyof GeminiStructuredResponse
): string {
  const value = parseStringField(payload, key).toUpperCase();

  if (!/^[SABCDEFG]$/.test(value)) {
    throw new Error(`Gemini JSON is missing a valid "${key}" grade`);
  }

  return value;
}

function validateGeminiJson(value: unknown): GeminiStructuredResponse {
  if (!isRecord(value)) {
    throw new Error('Gemini JSON must be an object');
  }

  const skillsValue = value.skills;
  if (!Array.isArray(skillsValue) || !skillsValue.every((skill) => typeof skill === 'string')) {
    throw new Error('Gemini JSON is missing a valid "skills" array');
  }

  return {
    name: parseStringField(value, 'name'),
    outfit: parseStringField(value, 'outfit'),
    speed: parseNumberField(value, 'speed'),
    stamina: parseNumberField(value, 'stamina'),
    power: parseNumberField(value, 'power'),
    guts: parseNumberField(value, 'guts'),
    wisdom: parseNumberField(value, 'wisdom'),
    surfaceAptitude: parseGradeField(value, 'surfaceAptitude'),
    distanceAptitude: parseGradeField(value, 'distanceAptitude'),
    strategyAptitude: parseGradeField(value, 'strategyAptitude'),
    strategy: parseStringField(value, 'strategy'),
    skills: skillsValue.map((skill) => skill.trim()).filter(Boolean)
  };
}

function parseGeminiJsonResponse(text: string): GeminiStructuredResponse {
  const jsonText = stripMarkdownFences(text);

  try {
    return validateGeminiJson(JSON.parse(jsonText));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Gemini returned malformed JSON', { cause: error });
    }

    throw error;
  }
}

function mapGeminiStrategyName(strategy: string): IStrategyName | undefined {
  const normalized = strategy.trim().toLowerCase();

  return STRATEGY_NAME_MAP[normalized];
}

function mapGeminiSkills(skills: Array<string>): Array<ExtractedSkill> {
  const extractedSkills: Array<ExtractedSkill> = [];
  const resolvedSkillIds = new Set<string>();

  for (const rawSkill of skills) {
    const skillName = rawSkill.trim();
    if (!skillsService.normalizeSkillName(skillName)) {
      continue;
    }

    const match = skillsService.findBestSkillMatch(skillName);
    if (!match) {
      continue;
    }

    const resolvedId = skillsService.resolveSkillId(match.id, /lvl\s*\d+/i.test(skillName));
    if (resolvedSkillIds.has(resolvedId)) {
      continue;
    }

    resolvedSkillIds.add(resolvedId);
    extractedSkills.push({
      id: resolvedId,
      name: match.name,
      confidence: match.confidence,
      originalText: skillName,
      fromImage: 0
    });
  }

  return extractedSkills;
}

function mapGeminiStructuredData(payload: GeminiStructuredResponse): Partial<ExtractedUmaData> {
  const structured: Partial<ExtractedUmaData> = {
    outfitName: payload.outfit || undefined,
    umaName: payload.name || undefined,
    umaConfidence: 0,
    speed: payload.speed,
    stamina: payload.stamina,
    power: payload.power,
    guts: payload.guts,
    wisdom: payload.wisdom,
    surfaceAptitude: payload.surfaceAptitude,
    distanceAptitude: payload.distanceAptitude,
    strategyAptitude: payload.strategyAptitude,
    strategy: mapGeminiStrategyName(payload.strategy),
    skills: mapGeminiSkills(payload.skills)
  };

  const umaMatch = findBestUmaMatch(payload.outfit, payload.name);
  if (umaMatch) {
    structured.outfitId = umaMatch.outfitId;
    structured.outfitName = umaMatch.outfitName;
    structured.umaName = umaMatch.umaName;
    structured.umaConfidence = umaMatch.confidence;
  }

  return structured;
}

/** Provides a single-use Cloudflare Turnstile token for one worker request. */
export type TurnstileTokenProvider = () => Promise<string>;

// Screenshots at or below this size go to the worker untouched. Larger images are
// downscaled so the worker's body cap (and Gemini's ~20MB inline-data limit) are never hit.
const IMAGE_PASSTHROUGH_MAX_BYTES = 3_000_000;
const IMAGE_MAX_EDGE = 2160;
const IMAGE_HARD_MAX_BYTES = 10_000_000;

const WORKER_ERROR_MESSAGES: Record<string, string> = {
  quota_exhausted: 'The shared screenshot-import quota is used up for now. Please try again later.',
  rate_limited: 'Too many imports right now. Wait a minute and try again.',
  turnstile: 'Verification failed. Complete the check and try again.',
  too_large: 'Screenshot is too large to process.'
};

/**
 * Downscales oversized screenshots before upload. Small images pass through untouched.
 * The 2160px edge cap keeps the tiny ○/◎/× skill glyphs legible for OCR.
 */
async function prepareImageForOcr(imageData: Blob | File): Promise<Blob> {
  if (imageData.size <= IMAGE_PASSTHROUGH_MAX_BYTES) {
    return imageData;
  }

  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') {
    if (imageData.size > IMAGE_HARD_MAX_BYTES) {
      throw new Error('Screenshot is too large to process.');
    }
    return imageData;
  }

  const bitmap = await createImageBitmap(imageData);
  try {
    const longestEdge = Math.max(bitmap.width, bitmap.height);
    const scale = longestEdge > IMAGE_MAX_EDGE ? IMAGE_MAX_EDGE / longestEdge : 1;
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not prepare the screenshot for processing.');
    }
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
    if (blob.size > IMAGE_HARD_MAX_BYTES) {
      throw new Error('Screenshot is too large to process.');
    }
    return blob;
  } finally {
    bitmap.close();
  }
}

/**
 * OCR engine backed by the `gemini-ocr` Cloudflare Worker. The worker holds the Gemini
 * API key and runs the extraction prompt server-side; this engine validates and maps
 * the returned text using client-side game data.
 */
export class WorkerGeminiEngine implements OcrEngine {
  private readonly workerUrl: string;
  private readonly getToken: TurnstileTokenProvider;

  constructor(workerUrl: string, getToken: TurnstileTokenProvider) {
    this.workerUrl = workerUrl;
    this.getToken = getToken;
  }

  async recognize(imageData: Blob | File): Promise<OcrEngineResult> {
    const prepared = await prepareImageForOcr(imageData);
    const token = await this.getToken();

    // Send raw bytes as multipart (no base64 bloat on the wire); the worker
    // base64-encodes server-side for Gemini's inline_data field.
    const form = new FormData();
    // Filename is irrelevant — the worker reads the mime type from the blob part.
    form.append('image', prepared, 'screenshot');
    form.append('token', token);

    // Let the browser set the multipart Content-Type (with boundary) automatically.
    const response = await fetch(this.workerUrl, { method: 'POST', body: form });

    const payload = (await response.json().catch(() => null)) as
      | { ok: true; text: string }
      | { ok: false; code?: string; error?: string }
      | null;

    if (!response.ok || !payload || payload.ok !== true) {
      const code = payload && payload.ok === false ? payload.code : undefined;
      const fallback =
        (payload && payload.ok === false && payload.error) ||
        'Screenshot import failed. Please try again.';
      throw new Error((code && WORKER_ERROR_MESSAGES[code]) || fallback);
    }

    const structured = mapGeminiStructuredData(parseGeminiJsonResponse(payload.text));

    return { structured };
  }

  async destroy(): Promise<void> {
    // No-op: the worker engine does not keep worker/process state alive.
  }
}
