import { describe, expect, it } from 'vitest';

import { loadSupportCards } from '@/modules/data/loaders/support-card-loader';
import type { SkillsMap } from '@/modules/data/services/SkillService';

const skills: SkillsMap = {
  '200012': {
    id: '200012',
    rarity: 2,
    tags: [],
    alternatives: [],
    groupId: 0,
    versions: [],
    family: [],
    iconId: '0',
    baseCost: 0,
    gradeValue: 0,
    order: 0,
    name: 'Right-Handed ○',
    character: []
  }
};

describe('loadSupportCards', () => {
  it('marks released from master cutover set, not release_en alone', () => {
    const cards = loadSupportCards(
      skills,
      [
        {
          support_id: 30010,
          char_id: 1022,
          rarity: 3,
          title_en: 'Released Card',
          hints: { hint_skills: [200012] },
          event_skills: []
        },
        {
          support_id: 39999,
          char_id: 1022,
          rarity: 3,
          title_en: 'Upcoming Card',
          hints: { hint_skills: [] },
          event_skills: []
        }
      ],
      new Set(['30010']),
      new Map(),
      new Map()
    );

    expect(cards['30010']?.released).toBe(true);
    expect(cards['39999']?.released).toBe(false);
  });
});
