import { beforeEach, describe, expect, it } from 'vitest';
import {
  createPlan,
  markBannerPulled,
  setCaratSetting,
  setPlannedPulls,
  setPullResultPickupCopies,
  useCaratStore
} from '@/store/carat.store';
import { gzipStringToBase64 } from '@/modules/runners/share/gzip-base64';
import {
  buildCaratPlanSnapshot,
  importCaratPlanSnapshot,
  parseCaratPlanSnapshotJson
} from './snapshot';
import { decodeCaratPlanShareCode, encodeCaratPlanShareCode } from './share-code';
import { recordedBannerCount, totalEffectivePulls } from './import-carat-plan-dialog';

const hasCompressionStream =
  typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

function resetToSinglePlan() {
  const id = createPlan('Plan 1');
  useCaratStore.setState((state) => ({
    plans: state.plans.filter((plan) => plan.id === id),
    activePlanId: id
  }));
}

function buildLegacySnapshot() {
  const snapshot = buildCaratPlanSnapshot();
  return {
    ...snapshot,
    version: 1 as const,
    plannedBanners: snapshot.plannedBanners.map(({ pullResult: _pullResult, ...banner }) => banner)
  };
}

describe('carat plan snapshot', () => {
  beforeEach(() => {
    resetToSinglePlan();
  });

  it('builds a v2 snapshot of the active plan with recorded results', () => {
    setCaratSetting('startingFreeCarats', 5000);
    setPlannedPulls('example-banner', 120);
    markBannerPulled('example-banner', 11);
    setPullResultPickupCopies('example-banner', 'pickup-1', 2);

    const snapshot = buildCaratPlanSnapshot();
    expect(snapshot.version).toBe(2);
    expect(snapshot.name).toBe('Plan 1');
    expect(snapshot.settings.startingFreeCarats).toBe(5000);
    expect(snapshot.plannedBanners.find((b) => b.id === 'example-banner')).toMatchObject({
      plannedPulls: 120,
      pullResult: { pulls: 120, ticketsUsed: 11, pickupCopies: { 'pickup-1': 2 } }
    });
  });

  it('normalizes a v1 JSON snapshot to v2 without recorded results', () => {
    const legacy = buildLegacySnapshot();

    const parsed = parseCaratPlanSnapshotJson(JSON.stringify(legacy));
    expect(parsed).toEqual({ ...legacy, version: 2 });
    expect(parsed?.plannedBanners.every((banner) => banner.pullResult === undefined)).toBe(true);
  });

  it('rejects garbage and future JSON versions', () => {
    const snapshot = buildCaratPlanSnapshot();

    expect(parseCaratPlanSnapshotJson('not json')).toBeNull();
    expect(parseCaratPlanSnapshotJson(JSON.stringify({ hello: 'world' }))).toBeNull();
    expect(parseCaratPlanSnapshotJson(JSON.stringify({ ...snapshot, version: 3 }))).toBeNull();
  });

  it('imports a snapshot as a NEW plan without touching existing plans', () => {
    const original = useCaratStore.getState().activePlanId;
    const snapshot = buildCaratPlanSnapshot();
    const editedSnapshot = {
      ...snapshot,
      name: 'Shared',
      settings: { ...snapshot.settings, startingFreeCarats: 7777 }
    };

    const countBefore = useCaratStore.getState().plans.length;
    const newId = importCaratPlanSnapshot(editedSnapshot);
    const state = useCaratStore.getState();

    expect(state.plans).toHaveLength(countBefore + 1);
    expect(newId).not.toBe(original);
    const imported = state.plans.find((p) => p.id === newId)!;
    expect(imported.name).toBe('Shared');
    expect(imported.settings.startingFreeCarats).toBe(7777);
    expect(state.plans.find((p) => p.id === original)?.settings.startingFreeCarats).not.toBe(7777);
  });

  it('uses recorded pulls in import previews and counts recorded banners', () => {
    setPlannedPulls('example-banner', 120);
    markBannerPulled('example-banner', 11);
    const snapshot = buildCaratPlanSnapshot();
    const originalBanner = snapshot.plannedBanners[0]!;
    const { pullResult: _pullResult, ...unrecordedBanner } = originalBanner;
    const preview = {
      ...snapshot,
      plannedBanners: [
        { ...originalBanner, pullResult: { ...originalBanner.pullResult!, pulls: 80 } },
        { ...unrecordedBanner, id: 'unrecorded-banner', plannedPulls: 40, order: 1 }
      ]
    };

    expect(totalEffectivePulls(preview)).toBe(120);
    expect(recordedBannerCount(preview)).toBe(1);
  });
});

describe.skipIf(!hasCompressionStream)('carat plan share code', () => {
  beforeEach(() => {
    resetToSinglePlan();
  });

  it('round-trips a v2 recorded result through cp2', async () => {
    setPlannedPulls('example-banner', 73);
    markBannerPulled('example-banner', 12);
    setPullResultPickupCopies('example-banner', 'pickup-1', 3);
    const snapshot = buildCaratPlanSnapshot();

    const code = await encodeCaratPlanShareCode(snapshot);
    expect(code.startsWith('cp2:')).toBe(true);
    expect(await decodeCaratPlanShareCode(code)).toEqual(snapshot);
  });

  it('normalizes a v1 cp1 payload to v2 without recorded results', async () => {
    const legacy = buildLegacySnapshot();
    const payload = await gzipStringToBase64(JSON.stringify(legacy));

    expect(await decodeCaratPlanShareCode(`cp1:${payload}`)).toEqual({ ...legacy, version: 2 });
  });

  it('rejects v1 snapshots that carry recorded results', async () => {
    setPlannedPulls('example-banner', 73);
    markBannerPulled('example-banner', 12);
    const legacyWithResult = { ...buildCaratPlanSnapshot(), version: 1 as const };
    const payload = await gzipStringToBase64(JSON.stringify(legacyWithResult));

    expect(parseCaratPlanSnapshotJson(JSON.stringify(legacyWithResult))).toBeNull();
    expect(await decodeCaratPlanShareCode(`cp1:${payload}`)).toBeNull();
  });

  it('rejects share-code prefix and payload version mismatches', async () => {
    const v2 = buildCaratPlanSnapshot();
    const v1 = buildLegacySnapshot();
    const [v2Payload, v1Payload] = await Promise.all([
      gzipStringToBase64(JSON.stringify(v2)),
      gzipStringToBase64(JSON.stringify(v1))
    ]);

    expect(await decodeCaratPlanShareCode(`cp1:${v2Payload}`)).toBeNull();
    expect(await decodeCaratPlanShareCode(`cp2:${v1Payload}`)).toBeNull();
  });

  it('rejects future share-code payload versions', async () => {
    const payload = await gzipStringToBase64(
      JSON.stringify({ ...buildCaratPlanSnapshot(), version: 3 })
    );

    expect(await decodeCaratPlanShareCode(`cp2:${payload}`)).toBeNull();
    expect(await decodeCaratPlanShareCode(`cp3:${payload}`)).toBeNull();
  });

  it('rejects malformed recorded results', async () => {
    const snapshot = buildCaratPlanSnapshot();
    const invalidResults = [
      { pulls: -1, ticketsUsed: 0, pickupCopies: {} },
      { pulls: 10, ticketsUsed: 11, pickupCopies: {} },
      { pulls: 10, ticketsUsed: 0, pickupCopies: { 'pickup-1': 1.5 } }
    ];

    for (const pullResult of invalidResults) {
      const malformed = {
        ...snapshot,
        plannedBanners: [{ ...snapshot.plannedBanners[0]!, pullResult }]
      };
      const payload = await gzipStringToBase64(JSON.stringify(malformed));

      expect(parseCaratPlanSnapshotJson(JSON.stringify(malformed))).toBeNull();
      expect(await decodeCaratPlanShareCode(`cp2:${payload}`)).toBeNull();
    }
  });

  it('strips a leading hash/URL', async () => {
    const code = await encodeCaratPlanShareCode(buildCaratPlanSnapshot());
    expect(await decodeCaratPlanShareCode(`https://example.com/carat#${code}`)).not.toBeNull();
  });

  it('rejects invalid input', async () => {
    expect(await decodeCaratPlanShareCode('')).toBeNull();
    expect(await decodeCaratPlanShareCode('not-a-code')).toBeNull();
    expect(await decodeCaratPlanShareCode('cp1:!!!notbase64!!!')).toBeNull();
    expect(await decodeCaratPlanShareCode('cp1:aGVsbG8')).toBeNull();

    const badPayload = await gzipStringToBase64(JSON.stringify({ hello: 'world' }));
    expect(await decodeCaratPlanShareCode(`cp1:${badPayload}`)).toBeNull();

    const goodPayload = await gzipStringToBase64(JSON.stringify(buildCaratPlanSnapshot()));
    expect(await decodeCaratPlanShareCode(`rs1:${goodPayload}`)).toBeNull();
  });
});
