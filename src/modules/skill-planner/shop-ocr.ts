import { skillsService } from '@/modules/data/services/SkillService';
import type { HintLevel } from './types';
import { getRelatedSkillIds, isSkillCoveredByOwnedFamily } from './skill-family';

export type ShopOcrSkillMatch = {
  id: string;
  name: string;
  rawName: string;
  hintLevel: HintLevel;
  confidence: number;
};

export type ShopOcrResult = {
  matches: Array<ShopOcrSkillMatch>;
  unmatchedNames: Array<string>;
};

export type RecognizedShopRow = {
  nameText: string;
  hintText: string;
  confidence: number;
};

export type ShopOcrProgress = {
  phase: 'loading' | 'recognizing';
  label: string;
  progress: number;
};

export type ShopOcrEngine = {
  recognize: (
    image: Blob | File,
    signal: AbortSignal,
    onProgress?: (progress: ShopOcrProgress) => void
  ) => Promise<ShopOcrResult>;
  destroy: () => Promise<void>;
};

type ShopReviewStatus = 'addable' | 'candidate-conflict' | 'obtained' | 'unavailable';

export type ShopReviewMatch = ShopOcrSkillMatch & {
  status: ShopReviewStatus;
  statusLabel?: string;
};

type ShopReviewContext = {
  existingCandidateIds: Iterable<string>;
  obtainedSkillIds: Iterable<string>;
  selectableSkillIds: Iterable<string>;
};

export type ShopImportProgress = {
  activeImage: number;
  activeImageProgress: number;
  completedImages: number;
  totalImages: number;
};

type ShopSkillCatalog = {
  findBestSkillMatch: (ocrText: string) => {
    id: string;
    name: string;
    confidence: number;
  } | null;
  resolveSkillId: (skillId: string, hasLevel: boolean) => string;
};

const SHOP_OCR_FILE_LIMITS = {
  maxFiles: 8,
  maxFileBytes: 10 * 1024 * 1024,
  maxTotalBytes: 40 * 1024 * 1024
} as const;

type ShopImageFileSelection = {
  acceptedFiles: Array<File>;
  errors: Array<string>;
};

type ProcessShopImageBatchOptions = {
  engine: Pick<ShopOcrEngine, 'recognize'>;
  signal: AbortSignal;
  onProgress?: (imageIndex: number, progress: ShopOcrProgress) => void;
  onResult?: (result: ShopOcrResult, file: File, imageIndex: number) => void;
  onFailure?: (error: unknown, file: File, imageIndex: number) => void;
  onSettled?: (file: File, imageIndex: number) => void;
};

export type ProcessShopImageBatchResult = {
  aborted: boolean;
  successfulCount: number;
  failedFiles: Array<string>;
};

const OCR_EDGE_ARTIFACTS = /^[|_=~—–\s]+|[|_=~—–\s]+$/gu;

export function cleanRecognizedShopName(value: string): string {
  return (
    value
      .split(/\r?\n/u)
      .map((line) => line.replaceAll(OCR_EDGE_ARTIFACTS, '').replaceAll(/\s+/gu, ' ').trim())
      .filter(Boolean)
      .sort((left, right) => right.length - left.length)[0] ?? ''
  );
}

export function parseShopHintLevel(value: string): HintLevel {
  const normalized = value.normalize('NFKC');
  // A level is only trusted when Tesseract also found an explicit Lv/Lvl/Level
  // label. Discount percentages by themselves must never become hint levels.
  const match = normalized.match(/hint\s*(?:level|lvl|lv[i1]?)\b[\s:.-]*([0-5ilo])/iu);
  const rawLevel = match?.[1]?.toLowerCase();

  if (rawLevel === 'i' || rawLevel === 'l') return 1;
  if (rawLevel === 'o') return 0;
  if (rawLevel && /^[0-5]$/u.test(rawLevel)) return Number(rawLevel) as HintLevel;
  return 0;
}

export function matchRecognizedShopRows(
  rows: Array<RecognizedShopRow>,
  catalog: ShopSkillCatalog = skillsService
): ShopOcrResult {
  const matchesById = new Map<string, ShopOcrSkillMatch>();
  const unmatchedNames = new Set<string>();

  for (const row of rows) {
    const rawName = cleanRecognizedShopName(row.nameText);
    if (!rawName) continue;

    const match = catalog.findBestSkillMatch(rawName);
    if (!match) {
      unmatchedNames.add(rawName);
      continue;
    }

    const id = catalog.resolveSkillId(match.id, false);
    const hintLevel = parseShopHintLevel(row.hintText);
    const existing = matchesById.get(id);

    if (!existing) {
      matchesById.set(id, {
        id,
        name: match.name,
        rawName,
        hintLevel,
        confidence: Math.min(match.confidence, Math.max(0, row.confidence / 100))
      });
      continue;
    }

    if (hintLevel > existing.hintLevel) {
      matchesById.set(id, { ...existing, hintLevel });
    }
  }

  return {
    matches: Array.from(matchesById.values()),
    unmatchedNames: Array.from(unmatchedNames)
  };
}

export function validateShopImageFiles(
  files: Array<File>,
  existingFiles: Array<Blob | File> = []
): ShopImageFileSelection {
  const acceptedFiles: Array<File> = [];
  const errors: Array<string> = [];
  let totalBytes = existingFiles.reduce((total, file) => total + file.size, 0);
  let totalFiles = existingFiles.length;

  for (const file of files) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      errors.push(`${file.name}: choose a PNG, JPEG, or WebP image.`);
      continue;
    }
    if (file.size > SHOP_OCR_FILE_LIMITS.maxFileBytes) {
      errors.push(`${file.name}: each screenshot must be 10 MB or smaller.`);
      continue;
    }
    if (totalFiles >= SHOP_OCR_FILE_LIMITS.maxFiles) {
      errors.push(`${file.name}: no more than 8 screenshots can be kept in one import.`);
      continue;
    }
    if (totalBytes + file.size > SHOP_OCR_FILE_LIMITS.maxTotalBytes) {
      errors.push(`${file.name}: screenshots in one import must total 40 MB or less.`);
      continue;
    }

    acceptedFiles.push(file);
    totalFiles += 1;
    totalBytes += file.size;
  }

  return { acceptedFiles, errors };
}

export async function processShopImageBatch(
  files: Array<File>,
  options: ProcessShopImageBatchOptions
): Promise<ProcessShopImageBatchResult> {
  const { engine, signal, onProgress, onResult, onFailure, onSettled } = options;
  const failedFiles: Array<string> = [];
  let successfulCount = 0;

  for (const [imageIndex, file] of files.entries()) {
    if (signal.aborted) {
      return { aborted: true, successfulCount, failedFiles };
    }

    try {
      const result = await engine.recognize(file, signal, (progress) =>
        onProgress?.(imageIndex, progress)
      );
      if (signal.aborted) {
        return { aborted: true, successfulCount, failedFiles };
      }

      successfulCount += 1;
      onResult?.(result, file, imageIndex);
    } catch (error) {
      if (signal.aborted) {
        return { aborted: true, successfulCount, failedFiles };
      }

      const message = error instanceof Error ? error.message : 'Screenshot import failed.';
      failedFiles.push(`${file.name}: ${message}`);
      onFailure?.(error, file, imageIndex);
    }

    onSettled?.(file, imageIndex);
  }

  return { aborted: false, successfulCount, failedFiles };
}

export function getShopImportProgressValue(progress: ShopImportProgress): number {
  if (progress.totalImages <= 0) return 0;
  const activeProgress = Math.min(1, Math.max(0, progress.activeImageProgress));
  return Math.min(
    100,
    Math.max(0, ((progress.completedImages + activeProgress) / progress.totalImages) * 100)
  );
}

export function mergeShopOcrResults(
  current: ShopOcrResult,
  incoming: ShopOcrResult
): ShopOcrResult {
  const matchesById = new Map(current.matches.map((match) => [match.id, match]));

  for (const match of incoming.matches) {
    const existing = matchesById.get(match.id);
    if (!existing || match.hintLevel > existing.hintLevel) {
      matchesById.set(match.id, existing ? { ...existing, hintLevel: match.hintLevel } : match);
    }
  }

  return {
    matches: Array.from(matchesById.values()),
    unmatchedNames: Array.from(new Set([...current.unmatchedNames, ...incoming.unmatchedNames]))
  };
}

export function classifyShopMatches(
  matches: Array<ShopOcrSkillMatch>,
  context: ShopReviewContext
): Array<ShopReviewMatch> {
  const existingCandidateIds = new Set(context.existingCandidateIds);
  const obtainedSkillIds = new Set(context.obtainedSkillIds);
  const selectableSkillIds = new Set(context.selectableSkillIds);

  return matches.map((match) => {
    if (!selectableSkillIds.has(match.id)) {
      return {
        ...match,
        status: 'unavailable',
        statusLabel: 'Not available for this runner'
      };
    }

    const hasCandidateConflict = getRelatedSkillIds(match.id).some((relatedId) =>
      existingCandidateIds.has(relatedId)
    );
    if (hasCandidateConflict) {
      return {
        ...match,
        status: 'candidate-conflict',
        statusLabel: 'Already represented in candidates'
      };
    }

    if (isSkillCoveredByOwnedFamily(match.id, obtainedSkillIds)) {
      return {
        ...match,
        status: 'obtained',
        statusLabel: 'Already obtained'
      };
    }

    return { ...match, status: 'addable' };
  });
}
