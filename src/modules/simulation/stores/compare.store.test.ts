import { beforeEach, describe, expect, it } from 'vitest';
import { createRunnerState } from '@/modules/runners/components/runner-card/domain/runner-state';
import { useRunnersStore } from '@/store/runners.store';
import {
  clampFieldSize,
  migrateComparePersisted,
  setCompareMode,
  useRaceStore,
  DEFAULT_COMPARE_MODE,
  DEFAULT_FIELD_SIZE,
  MIN_FIELD_SIZE
} from './compare.store';

describe('migrateComparePersisted', () => {
  it('maps v1 fieldComposition "mobs" to the default field size', () => {
    const migrated = migrateComparePersisted(
      { compareMode: 'contested', fieldComposition: 'mobs' },
      1
    );
    expect(migrated.fieldSize).toBe(DEFAULT_FIELD_SIZE);
    expect(migrated.compareMode).toBe(DEFAULT_COMPARE_MODE);
  });

  it('maps v1 fieldComposition "duo" to the minimum field size (no padding)', () => {
    const migrated = migrateComparePersisted(
      { compareMode: 'contested', fieldComposition: 'duo' },
      1
    );
    expect(migrated.fieldSize).toBe(MIN_FIELD_SIZE);
  });

  it('defaults v1 vacuum state to contested', () => {
    const migrated = migrateComparePersisted({ compareMode: 'vacuum' }, 1);
    expect(migrated.fieldSize).toBe(DEFAULT_FIELD_SIZE);
    expect(migrated.compareMode).toBe(DEFAULT_COMPARE_MODE);
  });

  it('maps v2 fillWithMobs booleans to field sizes', () => {
    expect(
      migrateComparePersisted({ compareMode: 'contested', fillWithMobs: true }, 2).fieldSize
    ).toBe(DEFAULT_FIELD_SIZE);
    expect(
      migrateComparePersisted({ compareMode: 'contested', fillWithMobs: false }, 2).fieldSize
    ).toBe(MIN_FIELD_SIZE);
    expect(migrateComparePersisted({ compareMode: 'contested' }, 2).fieldSize).toBe(
      DEFAULT_FIELD_SIZE
    );
  });

  it('preserves and clamps fieldSize for v3 blobs', () => {
    expect(migrateComparePersisted({ fieldSize: 11 }, 3).fieldSize).toBe(11);
    expect(migrateComparePersisted({ fieldSize: 99 }, 3).fieldSize).toBe(12);
    expect(migrateComparePersisted({}, 3).fieldSize).toBe(DEFAULT_FIELD_SIZE);
  });

  it('defaults a v4 blob to contested even when it contains vacuum', () => {
    expect(migrateComparePersisted({ compareMode: 'vacuum' }, 4).compareMode).toBe(
      DEFAULT_COMPARE_MODE
    );
  });

  it('preserves vacuum from a v5 blob', () => {
    expect(migrateComparePersisted({ compareMode: 'vacuum' }, 5).compareMode).toBe('vacuum');
  });

  it('clamps an invalid v5 compare mode to contested', () => {
    expect(migrateComparePersisted({ compareMode: 'invalid' }, 5).compareMode).toBe(
      DEFAULT_COMPARE_MODE
    );
  });
});

describe('clampFieldSize', () => {
  it('clamps into [2, 12] and rounds', () => {
    expect(clampFieldSize(1)).toBe(2);
    expect(clampFieldSize(13)).toBe(12);
    expect(clampFieldSize(9.6)).toBe(10);
    expect(clampFieldSize(Number.NaN)).toBe(DEFAULT_FIELD_SIZE);
  });
});

describe('setCompareMode', () => {
  const seedRunners = (count: number) => {
    const runners = Array.from({ length: count }, (_, index) => ({
      ...createRunnerState(),
      fieldId: `runner-${index}`
    }));
    useRunnersStore.setState({
      runners,
      compareA: runners[0].fieldId,
      compareB: runners[1].fieldId,
      editingId: runners[0].fieldId
    });
  };

  beforeEach(() => {
    seedRunners(MIN_FIELD_SIZE);
    useRaceStore.setState({ compareMode: DEFAULT_COMPARE_MODE });
  });

  it('allows vacuum for any field size', () => {
    seedRunners(3);
    setCompareMode('vacuum');
    expect(useRaceStore.getState().compareMode).toBe('vacuum');
  });

  it('keeps vacuum when the field grows past a duo', () => {
    setCompareMode('vacuum');
    seedRunners(3);
    expect(useRaceStore.getState().compareMode).toBe('vacuum');
  });
});
