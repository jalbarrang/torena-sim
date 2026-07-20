import { toast } from 'sonner';
import {
  replaceOwnedTrainees,
  useTraineeListStore,
  MAX_LEVEL,
  MIN_LEVEL
} from '@/store/trainee-list.store';

export const TRAINEE_LIST_SNAPSHOT_VERSION = 1;

type TraineeSnapshotEntry = {
  stars: number;
  potential: number;
};

export type TraineeListSnapshot = {
  version: typeof TRAINEE_LIST_SNAPSHOT_VERSION;
  exportedAt: number;
  trainees: Record<string, TraineeSnapshotEntry>;
};

export function buildTraineeListSnapshot(): TraineeListSnapshot {
  const { owned } = useTraineeListStore.getState();

  return {
    version: TRAINEE_LIST_SNAPSHOT_VERSION,
    exportedAt: Date.now(),
    trainees: Object.fromEntries(
      Object.entries(owned).map(([outfitId, entry]) => [
        outfitId,
        { stars: entry.stars, potential: entry.potential }
      ])
    )
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLevel(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= MIN_LEVEL && value <= MAX_LEVEL
  );
}

export type ParseTraineeListSnapshotResult =
  | { ok: true; snapshot: TraineeListSnapshot; skippedIds: Array<string> }
  | { ok: false; error: string };

/**
 * Parse and validate an exported trainee list. Entries whose outfit id is not
 * in `knownOutfitIds` (stale data, other server, typos) are skipped rather
 * than failing the whole import, and reported back for the UI to surface.
 */
export function parseTraineeListSnapshot(
  raw: string,
  knownOutfitIds: ReadonlySet<string>
): ParseTraineeListSnapshotResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Not valid JSON. Paste an exported trainee list (.json).' };
  }

  if (!isRecord(parsed)) {
    return { ok: false, error: 'Not a trainee list export.' };
  }

  if (parsed.version !== TRAINEE_LIST_SNAPSHOT_VERSION) {
    return { ok: false, error: 'Unsupported trainee list version.' };
  }

  if (!isRecord(parsed.trainees)) {
    return { ok: false, error: 'Export is missing the trainee data.' };
  }

  const trainees: Record<string, TraineeSnapshotEntry> = {};
  const skippedIds: Array<string> = [];

  for (const [outfitId, entry] of Object.entries(parsed.trainees)) {
    if (!knownOutfitIds.has(outfitId)) {
      skippedIds.push(outfitId);
      continue;
    }

    if (!isRecord(entry) || !isLevel(entry.stars) || !isLevel(entry.potential)) {
      return { ok: false, error: `Trainee ${outfitId} has invalid star or potential values.` };
    }

    trainees[outfitId] = { stars: entry.stars, potential: entry.potential };
  }

  return {
    ok: true,
    skippedIds,
    snapshot: {
      version: TRAINEE_LIST_SNAPSHOT_VERSION,
      exportedAt: typeof parsed.exportedAt === 'number' ? parsed.exportedAt : Date.now(),
      trainees
    }
  };
}

export function importTraineeListSnapshot(snapshot: TraineeListSnapshot): void {
  replaceOwnedTrainees(snapshot.trainees);
}

export function downloadTraineeListSnapshot(): void {
  try {
    const snapshot = buildTraineeListSnapshot();
    const json = JSON.stringify(snapshot, null, 2);
    const date = new Date(snapshot.exportedAt).toISOString().slice(0, 10);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `torena-trainee-list-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Trainee list exported');
  } catch {
    toast.error('Failed to export trainee list');
  }
}
