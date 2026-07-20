import { describe, expect, it } from 'vitest';

import { loadUmas } from '@/modules/data/loaders/uma-loader';

describe('loadUmas', () => {
  it('uses master cutover for released outfits, not GameTora release_en', () => {
    const result = loadUmas(
      [
        {
          char_id: 1001,
          card_id: 100101,
          name_jp: 'Test',
          name_en: 'Test EN',
          title_en_gl: 'Outfit A',
          rarity: 3
        },
        {
          char_id: 1001,
          card_id: 100102,
          name_jp: 'Test',
          name_en: 'Test EN',
          title_en_gl: 'Outfit B'
        }
      ],
      new Set(['100102'])
    );

    expect(result.releasedOutfits).toEqual(new Set(['100102']));
    expect(result.umas['1001']?.outfits['100101']).toBe('Outfit A');
    expect(result.umas['1001']?.outfits['100102']).toBe('Outfit B');
  });

  it('records per-outfit base rarity, defaulting to 1 when absent', () => {
    const result = loadUmas(
      [
        { char_id: 1001, card_id: 100101, rarity: 3 },
        { char_id: 1001, card_id: 100102 }
      ],
      new Set()
    );

    expect(result.umas['1001']?.rarities['100101']).toBe(3);
    expect(result.umas['1001']?.rarities['100102']).toBe(1);
  });
});
