import { describe, expect, it } from 'vitest';
import {
  LEGACY_FIELD_ID_A,
  LEGACY_FIELD_ID_B,
  MAX_RUNNERS,
  MIN_RUNNERS,
  addRunner,
  migrateRunnersPersisted,
  removeRunner,
  setCompareRole,
  useRunnersStore
} from '@/store/runners.store';
import { createRunnerState } from '@/modules/runners/components/runner-card/types';

describe('migrateRunnersPersisted', () => {
  it('migrates a legacy (version undefined) blob to a 2-runner field, preserving state', () => {
    const uma1 = createRunnerState({ speed: 1200, outfitId: 'a' });
    const uma2 = createRunnerState({ speed: 800, outfitId: 'b' });

    const migrated = migrateRunnersPersisted({ uma1, uma2, runnerId: 'uma2' }, 0);

    expect(migrated.runners).toHaveLength(2);
    expect(migrated.runners[0].fieldId).toBe(LEGACY_FIELD_ID_A);
    expect(migrated.runners[1].fieldId).toBe(LEGACY_FIELD_ID_B);
    expect(migrated.runners[0].speed).toBe(1200);
    expect(migrated.runners[1].outfitId).toBe('b');
    expect(migrated.compareA).toBe(LEGACY_FIELD_ID_A);
    expect(migrated.compareB).toBe(LEGACY_FIELD_ID_B);
    expect(migrated.editingId).toBe(LEGACY_FIELD_ID_B);
  });

  it('falls back to defaults for a corrupt blob', () => {
    const migrated = migrateRunnersPersisted({ runners: 'not-an-array' }, 1);
    expect(migrated.runners).toHaveLength(2);
    expect(migrated.compareA).not.toBe(migrated.compareB);
  });

  it('validates a version-1 blob and repairs an invalid compare pair', () => {
    const runners = [
      { ...createRunnerState(), fieldId: 'x' },
      { ...createRunnerState(), fieldId: 'y' }
    ];
    const migrated = migrateRunnersPersisted(
      { runners, compareA: 'x', compareB: 'x', editingId: 'x' },
      1
    );
    expect(migrated.compareA).toBe('x');
    expect(migrated.compareB).toBe('y');
  });
});

describe('runners store invariants', () => {
  function seed(count: number) {
    const runners = Array.from({ length: count }, (_, i) => ({
      ...createRunnerState(),
      fieldId: `f${i}`
    }));
    useRunnersStore.setState({
      runners,
      compareA: 'f0',
      compareB: 'f1',
      editingId: 'f0'
    });
  }

  it('rejects removing below the minimum field size', () => {
    seed(MIN_RUNNERS);
    removeRunner('f0');
    expect(useRunnersStore.getState().runners).toHaveLength(MIN_RUNNERS);
  });

  it('rejects adding beyond the maximum field size', () => {
    seed(MAX_RUNNERS);
    const id = addRunner();
    expect(id).toBeNull();
    expect(useRunnersStore.getState().runners).toHaveLength(MAX_RUNNERS);
  });

  it('reassigns a compare role when its holder is removed', () => {
    seed(3);
    removeRunner('f0'); // f0 held compareA
    const state = useRunnersStore.getState();
    expect(state.runners).toHaveLength(2);
    expect(state.compareA).not.toBe('f0');
    expect(state.compareA).not.toBe(state.compareB);
  });

  it('swaps roles when assigning a role to the holder of the other role', () => {
    seed(2);
    setCompareRole('f1', 'uma1'); // f1 was B; assigning to A swaps
    const state = useRunnersStore.getState();
    expect(state.compareA).toBe('f1');
    expect(state.compareB).toBe('f0');
  });
});
