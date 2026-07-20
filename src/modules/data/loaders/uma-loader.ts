import type { UmaAptitudes, UmasMap } from '@/modules/data/services/UmaService';

const DEFAULT_APTITUDE = 'G';

type CharacterCardSnapshot = {
  aptitude?: Array<string>;
  card_id: number;
  char_id: number;
  name_en?: string | null;
  name_jp?: string | null;
  rarity?: number;
  title_en_gl?: string | null;
  title_jp?: string | null;
};

const DEFAULT_RARITY = 1;

export type LoadUmasResult = {
  umas: UmasMap;
  releasedOutfits: Set<string>;
};

function normalizeAptitudes(aptitude: Array<string> = []): UmaAptitudes {
  return {
    turf: aptitude[0] ?? DEFAULT_APTITUDE,
    dirt: aptitude[1] ?? DEFAULT_APTITUDE,
    sprint: aptitude[2] ?? DEFAULT_APTITUDE,
    mile: aptitude[3] ?? DEFAULT_APTITUDE,
    medium: aptitude[4] ?? DEFAULT_APTITUDE,
    long: aptitude[5] ?? DEFAULT_APTITUDE,
    frontRunner: aptitude[6] ?? DEFAULT_APTITUDE,
    paceChaser: aptitude[7] ?? DEFAULT_APTITUDE,
    lateSurger: aptitude[8] ?? DEFAULT_APTITUDE,
    endCloser: aptitude[9] ?? DEFAULT_APTITUDE
  };
}

export function loadUmas(
  characterCards: Array<CharacterCardSnapshot>,
  releasedOutfits: Set<string>
): LoadUmasResult {
  const umas: UmasMap = {};

  for (const characterCard of characterCards) {
    const baseUmaId = String(characterCard.char_id);
    const outfitId = String(characterCard.card_id);
    const aptitudes = normalizeAptitudes(characterCard.aptitude);
    const rarity = characterCard.rarity ?? DEFAULT_RARITY;
    const existingEntry = umas[baseUmaId];

    if (!existingEntry) {
      umas[baseUmaId] = {
        name: [characterCard.name_jp || '', characterCard.name_en || ''],
        outfits: {
          [outfitId]: characterCard.title_en_gl || characterCard.title_jp || ''
        },
        aptitudes: {
          [outfitId]: aptitudes
        },
        rarities: {
          [outfitId]: rarity
        }
      };
    } else {
      if (!existingEntry.name[0] && characterCard.name_jp) {
        existingEntry.name[0] = characterCard.name_jp;
      }

      if (!existingEntry.name[1] && characterCard.name_en) {
        existingEntry.name[1] = characterCard.name_en;
      }

      existingEntry.outfits[outfitId] = characterCard.title_en_gl || characterCard.title_jp || '';
      existingEntry.aptitudes[outfitId] = aptitudes;
      existingEntry.rarities[outfitId] = rarity;
    }
  }

  return {
    umas,
    releasedOutfits
  };
}
