import { describe, expect, it } from 'vitest';
import {
  canUseVacuum,
  clampFieldSize,
  migrateComparePersisted,
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
    expect(migrated.compareMode).toBe('contested');
  });

  it('maps v1 fieldComposition "duo" to the minimum field size (no padding)', () => {
    const migrated = migrateComparePersisted(
      { compareMode: 'contested', fieldComposition: 'duo' },
      1
    );
    expect(migrated.fieldSize).toBe(MIN_FIELD_SIZE);
  });

  it('defaults to the default field size when fieldComposition is absent (v1)', () => {
    const migrated = migrateComparePersisted({ compareMode: 'vacuum' }, 1);
    expect(migrated.fieldSize).toBe(DEFAULT_FIELD_SIZE);
    expect(migrated.compareMode).toBe('vacuum');
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
});

describe('clampFieldSize', () => {
  it('clamps into [2, 12] and rounds', () => {
    expect(clampFieldSize(1)).toBe(2);
    expect(clampFieldSize(13)).toBe(12);
    expect(clampFieldSize(9.6)).toBe(10);
    expect(clampFieldSize(Number.NaN)).toBe(DEFAULT_FIELD_SIZE);
  });
});

describe('canUseVacuum', () => {
  it('allows vacuum only for a duo field', () => {
    expect(canUseVacuum(2)).toBe(true);
    expect(canUseVacuum(3)).toBe(false);
    expect(canUseVacuum(12)).toBe(false);
  });
});
