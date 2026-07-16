import { describe, expect, it } from 'vitest';

import {
  attachSupportCardEventSources,
  attachSupportCardHintSources
} from '@/modules/data/loaders/attach-support-sources';
import type { SkillEntry, SkillsMap } from '@/modules/data/services/SkillService';
import type { SupportCardsMap } from '@/modules/data/services/SupportCardService';

function createSkill(id: string): SkillEntry {
  return {
    id,
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
    name: `Skill ${id}`,
    character: []
  };
}

describe('attachSupportCardHintSources', () => {
  it('adds hint sources with sourceType hint', () => {
    const skills: SkillsMap = { '200012': createSkill('200012') };
    const supportCards: SupportCardsMap = {
      '30010': {
        id: 30010,
        name: '[Wave of Gratitude]',
        charaId: 1022,
        charaName: 'Test',
        rarity: 3,
        supportCardType: 1,
        released: true,
        hintSkills: [{ id: 200012, name: 'Right-Handed ○', rarity: 2 }],
        eventSkills: [],
        chainEventSkills: [],
        randomEventSkills: []
      }
    };

    attachSupportCardHintSources(skills, supportCards);

    expect(skills['200012']?.supportSources).toEqual([
      {
        supportCardId: 30010,
        charaId: 1022,
        rarity: 3,
        supportCardType: 1,
        name: '[Wave of Gratitude]',
        sourceType: 'hint'
      }
    ]);
  });
});

describe('attachSupportCardEventSources', () => {
  it('adds event sources with sourceType event', () => {
    const skills: SkillsMap = { '200331': createSkill('200331') };
    const supportCards: SupportCardsMap = {
      '30028': {
        id: 30028,
        name: '[Fire at My Heels]',
        charaId: 1061,
        charaName: 'Kitasan Black',
        rarity: 3,
        supportCardType: 1,
        released: true,
        hintSkills: [],
        eventSkills: [{ id: 200331, name: 'Professor of Curvature', rarity: 2 }],
        chainEventSkills: [],
        randomEventSkills: []
      }
    };

    attachSupportCardEventSources(skills, supportCards);

    expect(skills['200331']?.supportSources).toEqual([
      {
        supportCardId: 30028,
        charaId: 1061,
        rarity: 3,
        supportCardType: 1,
        name: '[Fire at My Heels]',
        sourceType: 'event'
      }
    ]);
  });

  it('keeps hint and event sources separate for the same card', () => {
    const skills: SkillsMap = {
      '200012': {
        ...createSkill('200012'),
        supportSources: [
          {
            supportCardId: 30010,
            charaId: 1022,
            rarity: 3,
            supportCardType: 1,
            name: '[Wave of Gratitude]',
            sourceType: 'hint'
          }
        ]
      }
    };
    const supportCards: SupportCardsMap = {
      '30010': {
        id: 30010,
        name: '[Wave of Gratitude]',
        charaId: 1022,
        charaName: 'Test',
        rarity: 3,
        supportCardType: 1,
        released: true,
        hintSkills: [{ id: 200012, name: 'Right-Handed ○', rarity: 2 }],
        eventSkills: [{ id: 200012, name: 'Right-Handed ○', rarity: 2 }],
        chainEventSkills: [],
        randomEventSkills: []
      }
    };

    attachSupportCardEventSources(skills, supportCards);

    expect(skills['200012']?.supportSources).toHaveLength(2);
    expect(skills['200012']?.supportSources?.map((source) => source.sourceType)).toEqual([
      'hint',
      'event'
    ]);
  });

  it('is idempotent when called twice', () => {
    const skills: SkillsMap = { '200331': createSkill('200331') };
    const supportCards: SupportCardsMap = {
      '30028': {
        id: 30028,
        name: '[Fire at My Heels]',
        charaId: 1061,
        charaName: 'Kitasan Black',
        rarity: 3,
        supportCardType: 1,
        released: true,
        hintSkills: [],
        eventSkills: [{ id: 200331, name: 'Professor of Curvature', rarity: 2 }],
        chainEventSkills: [],
        randomEventSkills: []
      }
    };

    attachSupportCardEventSources(skills, supportCards);
    attachSupportCardEventSources(skills, supportCards);

    expect(skills['200331']?.supportSources).toHaveLength(1);
  });
});
