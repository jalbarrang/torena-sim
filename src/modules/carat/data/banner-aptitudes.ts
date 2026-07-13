import characterCards from '@/modules/data/json/gametora/character-cards.json';
import type { TimelineEvent } from './timeline-types';

export type BannerAptitudeKey =
  | 'turf'
  | 'dirt'
  | 'sprint'
  | 'mile'
  | 'medium'
  | 'long'
  | 'front'
  | 'pace'
  | 'late'
  | 'end';

export type AptitudeSlot = { key: BannerAptitudeKey; label: string };

// Index order matches the gametora `aptitude` array:
// [turf, dirt, sprint, mile, medium, long, front, pace, late, end]
// (see normalizeAptitudes in src/modules/data/loaders/uma-loader.ts).
export const APTITUDE_SLOTS: ReadonlyArray<AptitudeSlot> = [
  { key: 'turf', label: 'Turf' },
  { key: 'dirt', label: 'Dirt' },
  { key: 'sprint', label: 'Sprint' },
  { key: 'mile', label: 'Mile' },
  { key: 'medium', label: 'Medium' },
  { key: 'long', label: 'Long' },
  { key: 'front', label: 'Front' },
  { key: 'pace', label: 'Pace' },
  { key: 'late', label: 'Late' },
  { key: 'end', label: 'End' }
];

type CharacterCardAptitudeRecord = {
  card_id: number;
  aptitude?: string[];
};

const aptitudeByCardId = new Map<number, string[]>(
  (characterCards as CharacterCardAptitudeRecord[])
    .filter((card) => Array.isArray(card.aptitude))
    .map((card) => [card.card_id, card.aptitude as string[]])
);

export type BannerAptitudes = {
  /** Grade-A buckets ("main" aptitudes). Union across pickup umas, in canonical order. */
  main: AptitudeSlot[];
  /** Grade-B buckets ("secondary" aptitudes) not already covered by a main grade. */
  secondary: AptitudeSlot[];
};

/**
 * Innate aptitudes of a character banner's pickup umas. "Main" is grade A —
 * S grades don't exist innately (only via career inspirations) — and
 * "secondary" is grade B. Returns null for non-character banners or when no
 * pickup card has aptitude data.
 */
export function bannerAptitudes(event: TimelineEvent): BannerAptitudes | null {
  if (event.card_type !== 'character') return null;

  const grades = (event.pickup_card_ids ?? [])
    .map((cardId) => aptitudeByCardId.get(cardId))
    .filter((aptitude): aptitude is string[] => aptitude !== undefined);

  if (grades.length === 0) return null;

  const main: AptitudeSlot[] = [];
  const secondary: AptitudeSlot[] = [];

  for (const [index, slot] of APTITUDE_SLOTS.entries()) {
    const slotGrades = new Set(grades.map((aptitude) => aptitude[index]));
    if (slotGrades.has('A')) {
      main.push(slot);
    } else if (slotGrades.has('B')) {
      secondary.push(slot);
    }
  }

  return { main, secondary };
}
