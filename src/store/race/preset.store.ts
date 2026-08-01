import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { RacePreset } from '@/utils/races';
import cmPresets from './cm-presets.json';

const PRESET_STORE_NAME = 'umalator-presets';
const PRESET_STORE_VERSION = 2;
const BUNDLED_PRESET_ADDITIONS_V2 = new Set([
  'c450e9b8-8255-5a78-992c-6e69f3326d2d',
  '63b4832b-dda6-5243-a159-04a54696916d',
  '24a47f6d-45c9-5a17-b872-9ba194f53d30',
  '5a01e28f-63e2-57bc-ab4e-153b47d6fa4d'
]);

const defaultPresets: Record<string, RacePreset> = Object.fromEntries(
  cmPresets.map((p) => [p.id, p as RacePreset])
);
const defaultPresetOrder = cmPresets.map((p) => p.id);
const bundledPresetIds = new Set(defaultPresetOrder);

export type IPresetStore = {
  presets: Record<string, RacePreset>;
  presetOrder: string[];
};

function insertPresetByBundledOrder(order: string[], id: string): void {
  const defaultIndex = defaultPresetOrder.indexOf(id);

  for (let index = defaultIndex - 1; index >= 0; index -= 1) {
    const previousIndex = order.indexOf(defaultPresetOrder[index]);
    if (previousIndex !== -1) {
      order.splice(previousIndex + 1, 0, id);
      return;
    }
  }

  for (let index = defaultIndex + 1; index < defaultPresetOrder.length; index += 1) {
    const nextIndex = order.indexOf(defaultPresetOrder[index]);
    if (nextIndex !== -1) {
      order.splice(nextIndex, 0, id);
      return;
    }
  }

  order.push(id);
}

function addBundledPresetAdditions(
  persisted: IPresetStore,
  additions: ReadonlySet<string>
): IPresetStore {
  const presets = { ...persisted.presets };
  const presetOrder = [...(persisted.presetOrder ?? [])];

  for (const id of defaultPresetOrder) {
    if (!additions.has(id) || presets[id]) continue;
    presets[id] = defaultPresets[id];
    insertPresetByBundledOrder(presetOrder, id);
  }

  const seen = new Set(presetOrder);
  for (const id of Object.keys(presets)) {
    if (!seen.has(id)) {
      presetOrder.push(id);
      seen.add(id);
    }
  }

  return { presets, presetOrder };
}

function migratePresetsPersisted(persistedState: unknown, version: number): IPresetStore {
  const persisted = persistedState as IPresetStore | null | undefined;
  const current = { presets: defaultPresets, presetOrder: defaultPresetOrder };
  if (!persisted) return current;
  if (version >= PRESET_STORE_VERSION) return persisted;

  if (version >= 1) {
    return addBundledPresetAdditions(persisted, BUNDLED_PRESET_ADDITIONS_V2);
  }

  const mergedPresets: Record<string, RacePreset> = { ...defaultPresets };
  for (const [id, preset] of Object.entries(persisted.presets)) {
    if (!bundledPresetIds.has(id)) {
      mergedPresets[id] = preset;
    }
  }

  const seen = new Set<string>(defaultPresetOrder);
  const presetOrder: string[] = [...defaultPresetOrder];
  for (const id of persisted.presetOrder ?? []) {
    if (!seen.has(id) && mergedPresets[id]) {
      presetOrder.push(id);
      seen.add(id);
    }
  }
  for (const id of Object.keys(mergedPresets)) {
    if (!seen.has(id)) {
      presetOrder.push(id);
      seen.add(id);
    }
  }

  return { presets: mergedPresets, presetOrder };
}

export const usePresetStore = create<IPresetStore>()(
  persist(
    (_) => ({
      presetOrder: defaultPresetOrder,
      presets: defaultPresets
    }),
    {
      name: PRESET_STORE_NAME,
      version: PRESET_STORE_VERSION,
      storage: createJSONStorage(() => localStorage),
      migrate: migratePresetsPersisted
    }
  )
);

export const addPreset = (preset: RacePreset) => {
  usePresetStore.setState((state) => ({
    presets: { ...state.presets, [preset.id]: preset },
    presetOrder: [preset.id, ...state.presetOrder]
  }));
};

export const updatePreset = (id: string, preset: RacePreset) => {
  usePresetStore.setState((state) => ({
    presets: { ...state.presets, [id]: preset }
  }));
};

export const deletePreset = (id: string) => {
  usePresetStore.setState((state) => {
    const { [id]: _, ...remainingPresets } = state.presets;
    return {
      presets: remainingPresets,
      presetOrder: state.presetOrder.filter((pid) => pid !== id)
    };
  });
};

export const deletePresets = (ids: string[]) => {
  const idSet = new Set(ids);
  usePresetStore.setState((state) => {
    const remaining: Record<string, RacePreset> = {};
    for (const [key, value] of Object.entries(state.presets)) {
      if (!idSet.has(key)) remaining[key] = value;
    }
    return {
      presets: remaining,
      presetOrder: state.presetOrder.filter((pid) => !idSet.has(pid))
    };
  });
};

export const reorderPresets = (newOrder: string[]) => {
  usePresetStore.setState({ presetOrder: newOrder });
};

export const resetPresets = () => {
  usePresetStore.setState({ presets: defaultPresets, presetOrder: defaultPresetOrder });
};

export { migratePresetsPersisted };
