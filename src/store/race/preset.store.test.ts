import { describe, expect, it } from 'vitest';
import type { RacePreset } from '@/utils/races';
import cmPresets from './cm-presets.json';
import { migratePresetsPersisted, type IPresetStore } from './preset.store';

const additionsV2 = [
  'c450e9b8-8255-5a78-992c-6e69f3326d2d',
  '63b4832b-dda6-5243-a159-04a54696916d',
  '24a47f6d-45c9-5a17-b872-9ba194f53d30',
  '5a01e28f-63e2-57bc-ab4e-153b47d6fa4d'
];
const bundled = cmPresets as RacePreset[];

describe('migratePresetsPersisted', () => {
  it('adds new bundled presets without restoring deleted presets', () => {
    const retained = bundled[0];
    const deleted = bundled[1];
    const custom = { ...retained, id: 'custom-preset', name: 'Custom' };
    const persisted: IPresetStore = {
      presets: { [retained.id]: retained, [custom.id]: custom },
      presetOrder: [retained.id, custom.id]
    };

    const migrated = migratePresetsPersisted(persisted, 1);

    expect(additionsV2.every((id) => migrated.presets[id])).toBe(true);
    expect(migrated.presets[deleted.id]).toBeUndefined();
    expect(migrated.presets[custom.id]).toEqual(custom);
    expect(migrated.presetOrder).toEqual([retained.id, ...additionsV2, custom.id]);
  });
});
