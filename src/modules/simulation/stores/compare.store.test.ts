import { describe, expect, it } from 'vitest';
import { canUseVacuum, migrateComparePersisted } from './compare.store';

describe('migrateComparePersisted', () => {
  it('maps v1 fieldComposition "mobs" to fillWithMobs true', () => {
    const migrated = migrateComparePersisted(
      { compareMode: 'contested', fieldComposition: 'mobs' },
      1
    );
    expect(migrated.fillWithMobs).toBe(true);
    expect(migrated.compareMode).toBe('contested');
  });

  it('maps v1 fieldComposition "duo" to fillWithMobs false', () => {
    const migrated = migrateComparePersisted(
      { compareMode: 'contested', fieldComposition: 'duo' },
      1
    );
    expect(migrated.fillWithMobs).toBe(false);
  });

  it('defaults fillWithMobs to true when fieldComposition is absent (v1)', () => {
    const migrated = migrateComparePersisted({ compareMode: 'vacuum' }, 1);
    expect(migrated.fillWithMobs).toBe(true);
    expect(migrated.compareMode).toBe('vacuum');
  });

  it('preserves fillWithMobs for v2 blobs', () => {
    const migrated = migrateComparePersisted({ compareMode: 'contested', fillWithMobs: false }, 2);
    expect(migrated.fillWithMobs).toBe(false);
  });
});

describe('canUseVacuum', () => {
  it('allows vacuum only for a duo field', () => {
    expect(canUseVacuum(2)).toBe(true);
    expect(canUseVacuum(3)).toBe(false);
    expect(canUseVacuum(12)).toBe(false);
  });
});
