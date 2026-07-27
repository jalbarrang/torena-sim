import {
  extractEncodedPayload,
  gzipStringToBase64,
  gunzipBase64ToString
} from '@/modules/runners/share/gzip-base64';
import { parseCaratPlanSnapshotJsonWithVersion } from './snapshot';
import {
  CARAT_PLAN_SNAPSHOT_VERSION,
  LEGACY_CARAT_PLAN_SNAPSHOT_VERSION,
  type CaratPlanSnapshot,
  type CaratPlanSnapshotVersion
} from './types';

const SHARE_CODE_PREFIXES: Record<CaratPlanSnapshotVersion, string> = {
  [LEGACY_CARAT_PLAN_SNAPSHOT_VERSION]: 'cp1:',
  [CARAT_PLAN_SNAPSHOT_VERSION]: 'cp2:'
};

export async function encodeCaratPlanShareCode(snapshot: CaratPlanSnapshot): Promise<string> {
  const json = JSON.stringify(snapshot);
  const payload = await gzipStringToBase64(json);
  return `${SHARE_CODE_PREFIXES[CARAT_PLAN_SNAPSHOT_VERSION]}${payload}`;
}

function shareCodeVersion(encoded: string): CaratPlanSnapshotVersion | null {
  if (encoded.startsWith(SHARE_CODE_PREFIXES[LEGACY_CARAT_PLAN_SNAPSHOT_VERSION])) {
    return LEGACY_CARAT_PLAN_SNAPSHOT_VERSION;
  }
  if (encoded.startsWith(SHARE_CODE_PREFIXES[CARAT_PLAN_SNAPSHOT_VERSION])) {
    return CARAT_PLAN_SNAPSHOT_VERSION;
  }
  return null;
}

export async function decodeCaratPlanShareCode(input: string): Promise<CaratPlanSnapshot | null> {
  try {
    const encoded = extractEncodedPayload(input);
    const sourceVersion = shareCodeVersion(encoded);
    if (sourceVersion === null) return null;

    const prefix = SHARE_CODE_PREFIXES[sourceVersion];
    const payload = encoded.slice(prefix.length);
    if (!payload) return null;

    const json = await gunzipBase64ToString(payload);
    return parseCaratPlanSnapshotJsonWithVersion(json, sourceVersion)?.snapshot ?? null;
  } catch {
    return null;
  }
}
