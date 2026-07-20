import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

const TRAINEE_LIST_STORE_NAME = 'umalator-trainee-list';

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 5;

export type OwnedTrainee = {
  stars: number;
  potential: number;
  addedAt: number;
};

type TraineeListState = {
  owned: Record<string, OwnedTrainee>;
};

function clampLevel(value: number, min = MIN_LEVEL): number {
  const floored = Math.floor(Number.isFinite(value) ? value : min);
  return Math.min(MAX_LEVEL, Math.max(min, floored));
}

/** Stars can never go below the card's base rarity (the game unlocks cards at their base star count). */
export function clampStars(stars: number, baseRarity: number): number {
  return clampLevel(stars, clampLevel(baseRarity));
}

export function clampPotential(potential: number): number {
  return clampLevel(potential);
}

function normalizeOwned(value: unknown): Record<string, OwnedTrainee> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }

  const owned: Record<string, OwnedTrainee> = {};

  for (const [outfitId, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Partial<OwnedTrainee>;
    owned[outfitId] = {
      stars: clampLevel(typeof record.stars === 'number' ? record.stars : MIN_LEVEL),
      potential: clampLevel(typeof record.potential === 'number' ? record.potential : MIN_LEVEL),
      addedAt: typeof record.addedAt === 'number' ? record.addedAt : Date.now()
    };
  }

  return owned;
}

export const useTraineeListStore = create<TraineeListState>()(
  persist(() => ({ owned: {} }), {
    name: TRAINEE_LIST_STORE_NAME,
    storage: createJSONStorage(() => localStorage),
    merge: (persisted, current) => ({
      ...current,
      owned: normalizeOwned((persisted as Partial<TraineeListState> | undefined)?.owned)
    })
  })
);

export function addOwnedTrainee(outfitId: string, baseRarity: number) {
  useTraineeListStore.setState((state) => {
    if (state.owned[outfitId]) {
      return state;
    }

    return {
      owned: {
        ...state.owned,
        [outfitId]: {
          stars: clampStars(baseRarity, baseRarity),
          potential: MIN_LEVEL,
          addedAt: Date.now()
        }
      }
    };
  });
}

export function removeOwnedTrainee(outfitId: string) {
  useTraineeListStore.setState((state) => {
    if (!state.owned[outfitId]) {
      return state;
    }

    const next = { ...state.owned };
    delete next[outfitId];
    return { owned: next };
  });
}

export function setTraineeStars(outfitId: string, stars: number, baseRarity: number) {
  useTraineeListStore.setState((state) => {
    const entry = state.owned[outfitId];
    if (!entry) {
      return state;
    }

    return {
      owned: {
        ...state.owned,
        [outfitId]: { ...entry, stars: clampStars(stars, baseRarity) }
      }
    };
  });
}

export function setTraineePotential(outfitId: string, potential: number) {
  useTraineeListStore.setState((state) => {
    const entry = state.owned[outfitId];
    if (!entry) {
      return state;
    }

    return {
      owned: {
        ...state.owned,
        [outfitId]: { ...entry, potential: clampPotential(potential) }
      }
    };
  });
}

/** Replace the entire owned map (JSON import). Values are expected to be pre-validated. */
export function replaceOwnedTrainees(
  trainees: Record<string, { stars: number; potential: number }>
) {
  const now = Date.now();
  const owned: Record<string, OwnedTrainee> = {};

  for (const [outfitId, entry] of Object.entries(trainees)) {
    owned[outfitId] = {
      stars: clampLevel(entry.stars),
      potential: clampLevel(entry.potential),
      addedAt: now
    };
  }

  useTraineeListStore.setState({ owned });
}
