import { cloneDeep } from 'es-toolkit';
import { toast } from 'sonner';
import {
  createPlan,
  getActivePlan,
  useCaratStore,
  type BannerPullResult,
  type CaratPlan,
  type CaratSettings,
  type PlannedBanner
} from '@/store/carat.store';
import {
  CARAT_PLAN_SNAPSHOT_VERSION,
  LEGACY_CARAT_PLAN_SNAPSHOT_VERSION,
  type CaratPlanSnapshot,
  type CaratPlanSnapshotVersion
} from './types';

export function buildCaratPlanSnapshot(planId?: string): CaratPlanSnapshot {
  const state = useCaratStore.getState();
  const plan: CaratPlan =
    (planId ? state.plans.find((p) => p.id === planId) : undefined) ?? getActivePlan(state);

  return {
    version: CARAT_PLAN_SNAPSHOT_VERSION,
    timestamp: Date.now(),
    name: plan.name,
    settings: cloneDeep(plan.settings),
    plannedBanners: plan.plannedBanners.map(normalizeBannerForSnapshot),
    paidPurchases: cloneDeep(plan.paidPurchases),
    selectorChoices: cloneDeep(plan.selectorChoices)
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isSettings(value: unknown): value is CaratSettings {
  if (!isRecord(value)) return false;
  return (
    (value.server === 'global' || value.server === 'jp') &&
    typeof value.startingFreeCarats === 'number' &&
    typeof value.startingPaidCarats === 'number' &&
    typeof value.umaTickets === 'number' &&
    typeof value.supportTickets === 'number' &&
    typeof value.monthlyCarats === 'number' &&
    typeof value.monthlyTickets === 'number' &&
    typeof value.teamTrialsClass === 'string' &&
    typeof value.clubRank === 'string' &&
    typeof value.cmPlacement === 'string' &&
    typeof value.lohRank === 'string' &&
    typeof value.dailyCaratPack === 'boolean' &&
    typeof value.trainingPass === 'string' &&
    typeof value.trackPaidCarats === 'boolean'
  );
}

function isPickupCopies(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.values(value).every(isNonNegativeInteger);
}

function isPullResult(value: unknown): value is BannerPullResult {
  if (!isRecord(value)) return false;
  return (
    isNonNegativeInteger(value.pulls) &&
    isNonNegativeInteger(value.ticketsUsed) &&
    value.ticketsUsed <= value.pulls &&
    isPickupCopies(value.pickupCopies)
  );
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isPlannedBanner(
  value: unknown,
  sourceVersion: CaratPlanSnapshotVersion
): value is PlannedBanner {
  if (!isRecord(value)) return false;
  if (
    typeof value.id !== 'string' ||
    typeof value.plannedPulls !== 'number' ||
    typeof value.startingDupes !== 'number' ||
    !isRecord(value.copyGoals) ||
    !isRecord(value.ownedCopies) ||
    typeof value.order !== 'number' ||
    (value.ticketsUsed !== undefined && typeof value.ticketsUsed !== 'number')
  ) {
    return false;
  }

  if (!hasOwn(value, 'pullResult')) return true;
  return sourceVersion === CARAT_PLAN_SNAPSHOT_VERSION && isPullResult(value.pullResult);
}

function normalizeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function normalizePullResultForSnapshot(value: BannerPullResult): BannerPullResult {
  const pulls = normalizeCount(value.pulls);
  const pickupCopies = isRecord(value.pickupCopies)
    ? Object.fromEntries(
        Object.entries(value.pickupCopies).map(([cardId, copies]) => [
          cardId,
          normalizeCount(copies)
        ])
      )
    : {};

  return {
    pulls,
    ticketsUsed: Math.min(pulls, normalizeCount(value.ticketsUsed)),
    pickupCopies
  };
}

function normalizeBannerForSnapshot(banner: PlannedBanner): PlannedBanner {
  const { pullResult, ...plan } = cloneDeep(banner);
  return pullResult ? { ...plan, pullResult: normalizePullResultForSnapshot(pullResult) } : plan;
}

export type ParsedCaratPlanSnapshot = {
  snapshot: CaratPlanSnapshot;
  sourceVersion: CaratPlanSnapshotVersion;
};

/** Parse a strict v1 or v2 payload, normalizing compatible v1 data to current v2. */
export function parseCaratPlanSnapshotJsonWithVersion(
  raw: string,
  expectedVersion?: CaratPlanSnapshotVersion
): ParsedCaratPlanSnapshot | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;
  const sourceVersion = parsed.version;
  if (
    sourceVersion !== LEGACY_CARAT_PLAN_SNAPSHOT_VERSION &&
    sourceVersion !== CARAT_PLAN_SNAPSHOT_VERSION
  ) {
    return null;
  }
  if (expectedVersion !== undefined && sourceVersion !== expectedVersion) return null;
  const timestamp = parsed.timestamp;
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return null;
  if (typeof parsed.name !== 'string') return null;
  if (!isSettings(parsed.settings)) return null;
  if (
    !Array.isArray(parsed.plannedBanners) ||
    !parsed.plannedBanners.every((banner) => isPlannedBanner(banner, sourceVersion))
  ) {
    return null;
  }
  if (!isRecord(parsed.paidPurchases)) return null;
  if (!isRecord(parsed.selectorChoices)) return null;

  const plannedBanners = parsed.plannedBanners.map((banner) => {
    const { pullResult: _pullResult, ...resultFreeBanner } = banner;
    return sourceVersion === LEGACY_CARAT_PLAN_SNAPSHOT_VERSION
      ? resultFreeBanner
      : (banner as PlannedBanner);
  });

  return {
    sourceVersion,
    snapshot: {
      version: CARAT_PLAN_SNAPSHOT_VERSION,
      timestamp,
      name: parsed.name,
      settings: parsed.settings,
      plannedBanners,
      paidPurchases: parsed.paidPurchases as CaratPlanSnapshot['paidPurchases'],
      selectorChoices: parsed.selectorChoices as CaratPlanSnapshot['selectorChoices']
    }
  };
}

export function parseCaratPlanSnapshotJson(raw: string): CaratPlanSnapshot | null {
  return parseCaratPlanSnapshotJsonWithVersion(raw)?.snapshot ?? null;
}

/** Import a snapshot as a NEW plan and make it active. Returns the new plan id. */
export function importCaratPlanSnapshot(snapshot: CaratPlanSnapshot): string {
  const newPlanId = createPlan(snapshot.name);
  useCaratStore.setState((state) => ({
    plans: state.plans.map((plan) =>
      plan.id === newPlanId
        ? {
            ...plan,
            settings: cloneDeep(snapshot.settings),
            plannedBanners: cloneDeep(snapshot.plannedBanners),
            paidPurchases: cloneDeep(snapshot.paidPurchases),
            selectorChoices: cloneDeep(snapshot.selectorChoices),
            updatedAt: Date.now()
          }
        : plan
    )
  }));
  return newPlanId;
}

function shortHash(value: string): string {
  // FNV-1a 32-bit hash rendered as base36, for a compact filename suffix.
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0').slice(0, 7);
}

export function downloadCaratPlanSnapshot(planId?: string, filename?: string): void {
  try {
    const snapshot = buildCaratPlanSnapshot(planId);
    const json = JSON.stringify(snapshot, null, 2);
    const resolvedFilename = filename ?? `torena-carat-plan-${shortHash(json)}.json`;
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = resolvedFilename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Pull plan exported');
  } catch {
    toast.error('Failed to export pull plan');
  }
}
