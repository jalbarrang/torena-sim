import { beforeEach, describe, expect, it } from 'vitest';
import {
  addOwnedTrainee,
  clampPotential,
  clampStars,
  removeOwnedTrainee,
  replaceOwnedTrainees,
  setTraineePotential,
  setTraineeStars,
  useTraineeListStore
} from '@/store/trainee-list.store';

function resetStore() {
  useTraineeListStore.setState({ owned: {} });
}

describe('trainee-list.store', () => {
  beforeEach(resetStore);

  it('adds an owned trainee with stars defaulting to base rarity and potential 1', () => {
    addOwnedTrainee('100101', 3);

    const entry = useTraineeListStore.getState().owned['100101'];
    expect(entry).toBeDefined();
    expect(entry.stars).toBe(3);
    expect(entry.potential).toBe(1);
    expect(entry.addedAt).toBeGreaterThan(0);
  });

  it('does not overwrite an existing entry when added twice', () => {
    addOwnedTrainee('100101', 1);
    setTraineeStars('100101', 5, 1);
    addOwnedTrainee('100101', 1);

    expect(useTraineeListStore.getState().owned['100101'].stars).toBe(5);
  });

  it('removes an owned trainee', () => {
    addOwnedTrainee('100101', 2);
    removeOwnedTrainee('100101');

    expect(useTraineeListStore.getState().owned['100101']).toBeUndefined();
  });

  it('clamps stars between base rarity and 5', () => {
    addOwnedTrainee('100101', 3);

    setTraineeStars('100101', 1, 3);
    expect(useTraineeListStore.getState().owned['100101'].stars).toBe(3);

    setTraineeStars('100101', 9, 3);
    expect(useTraineeListStore.getState().owned['100101'].stars).toBe(5);
  });

  it('clamps potential between 1 and 5', () => {
    addOwnedTrainee('100101', 1);

    setTraineePotential('100101', 0);
    expect(useTraineeListStore.getState().owned['100101'].potential).toBe(1);

    setTraineePotential('100101', 7);
    expect(useTraineeListStore.getState().owned['100101'].potential).toBe(5);
  });

  it('ignores stars/potential updates for unowned trainees', () => {
    setTraineeStars('100101', 4, 1);
    setTraineePotential('100101', 4);

    expect(useTraineeListStore.getState().owned).toEqual({});
  });

  it('replaces the whole owned map on import', () => {
    addOwnedTrainee('100101', 3);

    replaceOwnedTrainees({
      '100201': { stars: 4, potential: 2 },
      '100301': { stars: 99, potential: -1 }
    });

    const owned = useTraineeListStore.getState().owned;
    expect(owned['100101']).toBeUndefined();
    expect(owned['100201']).toMatchObject({ stars: 4, potential: 2 });
    // Out-of-range imported values are clamped to the 1-5 band.
    expect(owned['100301']).toMatchObject({ stars: 5, potential: 1 });
  });

  it('exposes clamp helpers used by the UI', () => {
    expect(clampStars(2, 3)).toBe(3);
    expect(clampStars(4.7, 1)).toBe(4);
    expect(clampPotential(Number.NaN)).toBe(1);
  });
});
