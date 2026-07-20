import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildTraineeListSnapshot,
  importTraineeListSnapshot,
  parseTraineeListSnapshot,
  TRAINEE_LIST_SNAPSHOT_VERSION
} from '@/modules/trainee-list/share/snapshot';
import { addOwnedTrainee, useTraineeListStore } from '@/store/trainee-list.store';

const KNOWN_IDS = new Set(['100101', '100201', '100301']);

function resetStore() {
  useTraineeListStore.setState({ owned: {} });
}

describe('trainee-list snapshot', () => {
  beforeEach(resetStore);

  it('round-trips build -> parse -> import', () => {
    addOwnedTrainee('100101', 3);
    addOwnedTrainee('100201', 1);

    const snapshot = buildTraineeListSnapshot();
    const json = JSON.stringify(snapshot);

    resetStore();

    const result = parseTraineeListSnapshot(json, KNOWN_IDS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.skippedIds).toEqual([]);
    importTraineeListSnapshot(result.snapshot);

    const owned = useTraineeListStore.getState().owned;
    expect(owned['100101']).toMatchObject({ stars: 3, potential: 1 });
    expect(owned['100201']).toMatchObject({ stars: 1, potential: 1 });
  });

  it('rejects invalid JSON', () => {
    const result = parseTraineeListSnapshot('not json{', KNOWN_IDS);
    expect(result.ok).toBe(false);
  });

  it('rejects unknown versions', () => {
    const result = parseTraineeListSnapshot(
      JSON.stringify({ version: 999, exportedAt: 0, trainees: {} }),
      KNOWN_IDS
    );
    expect(result).toEqual({ ok: false, error: 'Unsupported trainee list version.' });
  });

  it('rejects out-of-range star or potential values', () => {
    const result = parseTraineeListSnapshot(
      JSON.stringify({
        version: TRAINEE_LIST_SNAPSHOT_VERSION,
        exportedAt: 0,
        trainees: { '100101': { stars: 6, potential: 1 } }
      }),
      KNOWN_IDS
    );
    expect(result.ok).toBe(false);
  });

  it('skips unknown outfit ids instead of failing the import', () => {
    const result = parseTraineeListSnapshot(
      JSON.stringify({
        version: TRAINEE_LIST_SNAPSHOT_VERSION,
        exportedAt: 0,
        trainees: {
          '100101': { stars: 3, potential: 2 },
          '999999': { stars: 1, potential: 1 }
        }
      }),
      KNOWN_IDS
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skippedIds).toEqual(['999999']);
    expect(Object.keys(result.snapshot.trainees)).toEqual(['100101']);
  });
});
