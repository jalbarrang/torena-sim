import { getIconUrl } from '@/assets/icons';
import { useMemo } from 'react';
import { getIconById } from '@/modules/data/icons';
import { umasService } from '@/modules/data/services/UmaService';
import type { UmaAptitudes } from '@/modules/data/services/UmaService';

export type UmaSearchEntry = {
  id: string;
  name: string;
  outfit: string;
  aptitudes: UmaAptitudes;
  rarity: number;
};

type Uma = {
  name: Array<string>;
  outfits: Record<string, string>;
};

type UmaSearchData = {
  altIds: Array<string>;
  namesForSearch: Record<string, string>;
  umasForSearch: Array<UmaSearchEntry>;
};

const umaSearchDataCache = new Map<boolean, UmaSearchData>();

function buildUmaSearchData(includeUpcoming = false): UmaSearchData {
  const cached = umaSearchDataCache.get(includeUpcoming);
  if (cached) {
    return cached;
  }

  const altIds = umasService.getAllEntries().flatMap(([_id, uma]) => {
    if (!uma) {
      return [];
    }

    return Object.keys(uma.outfits).filter(
      (outfitId) => includeUpcoming || umasService.isReleased(outfitId)
    );
  });

  const namesForSearch = Object.fromEntries(
    altIds.map((id) => {
      const baseId = getUmaBaseId(id);
      const uma = umasService.getById(baseId);
      if (!uma) {
        return [id, ''];
      }

      return [id, (uma.outfits[id] + ' ' + uma.name[1]).toUpperCase().replaceAll('.', '')];
    })
  );

  const umasForSearch = altIds
    .map((id) => {
      const baseId = getUmaBaseId(id);
      const uma = umasService.getById(baseId);
      if (!uma) {
        return null;
      }

      return {
        id,
        name: uma.name[1],
        outfit: uma.outfits[id],
        aptitudes: uma.aptitudes[id],
        rarity: uma.rarities[id] ?? 1
      };
    })
    .filter((entry): entry is UmaSearchEntry => entry !== null);

  const result = {
    altIds,
    namesForSearch,
    umasForSearch
  };

  umaSearchDataCache.set(includeUpcoming, result);

  return result;
}

// Base Functions

const getUmaBaseId = (id: string) => {
  if (id.length > 4) {
    return id.slice(0, 4);
  }

  return id;
};

const getUmaById = (id: string) => {
  const baseId = getUmaBaseId(id);

  const uma = umasService.getById(baseId);

  if (!uma) {
    throw new Error(`Uma with id ${id} not found`);
  }

  return uma;
};

export type UmaAltId = string;
const getUmaAltIds = (includeUpcoming = false) => buildUmaSearchData(includeUpcoming).altIds;

// Lookup Functions

const getUmaNamesForSearch = (includeUpcoming = false) =>
  buildUmaSearchData(includeUpcoming).namesForSearch;
const getUmasForSearch = (includeUpcoming = false) =>
  buildUmaSearchData(includeUpcoming).umasForSearch;

export function useUmasForSearch(includeUpcoming = false): Array<UmaSearchEntry> {
  return useMemo(() => buildUmaSearchData(includeUpcoming).umasForSearch, [includeUpcoming]);
}

export function rankForStat(x: number) {
  if (x > 1200) {
    // over 1200 letter (eg UG) goes up by 100 and minor number (eg UG8) goes up by 10
    return Math.min(18 + Math.floor((x - 1200) / 100) * 10 + (Math.floor(x / 10) % 10), 97);
  } else if (x >= 1150) {
    return 17; // SS+
  } else if (x >= 1100) {
    return 16; // SS
  } else if (x >= 400) {
    // between 400 and 1100 letter goes up by 100 starting with C (8)
    return 8 + Math.floor((x - 400) / 100);
  } else {
    // between 1 and 400 letter goes up by 50 starting with G+ (0)
    return Math.floor(x / 50);
  }
}
function searchNames(query: string, includeUpcoming = false) {
  const q = query.toUpperCase().replaceAll('.', '');
  const namesForSearch = getUmaNamesForSearch(includeUpcoming);
  return getUmaAltIds(includeUpcoming).filter((oid) => namesForSearch[oid]?.indexOf(q) > -1);
}

// Image URL Utilities

/**
 * Get the icon image URL for an Uma outfit ID
 * Falls back to a random mob image if no outfit ID is provided
 */
export const getUmaImageUrl = (outfitId: string | undefined, randomMobId?: number): string => {
  if (outfitId) {
    return getIconById(outfitId) ?? getMobImageUrl(randomMobId);
  }

  return getMobImageUrl(randomMobId);
};

/**
 * Get the image URL for a random mob
 */
const getMobImageUrl = (randomMobId = 8000): string => {
  return getIconUrl(`mob/trained_mob_chr_icon_${randomMobId}_000001_01.png`);
};

/**
 * Get Uma outfit name by outfit ID
 */
const getUmaOutfitName = (outfitId: string): string | null => {
  try {
    const uma = getUmaById(outfitId);
    return uma.outfits[outfitId] || null;
  } catch {
    return null;
  }
};

/**
 * Get Uma display info (name + outfit) by outfit ID
 */
export const getUmaDisplayInfo = (
  outfitId: string
): { name: string; outfit: string; rarity: number } | null => {
  try {
    const uma = getUmaById(outfitId);

    return {
      name: uma.name[1],
      outfit: uma.outfits[outfitId],
      rarity: uma.rarities[outfitId] ?? 1
    };
  } catch {
    return null;
  }
};
