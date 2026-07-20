import type { MarginTier, MemberRaceRow, RaceResult } from '../model/score-sheet';
import { WIN_MARGIN_POINTS } from '../model/scoring-tables';

export const PLACES = Array.from({ length: 12 }, (_, index) => index + 1);

const PLACE_LABELS: Record<number, string> = { 1: '1st', 2: '2nd', 3: '3rd' };

export function placeLabel(place: number): string {
  return PLACE_LABELS[place] ?? `${place}th`;
}

export const MARGIN_LABELS: Record<MarginTier, string> = {
  nose: 'Nose',
  head: 'Head',
  neck: 'Neck',
  halfLength: '½L',
  threeQuarterLengths: '¾L',
  oneLength: '1L',
  oneQuarterLengths: '1¼L',
  oneHalfLengths: '1½L',
  oneThreeQuarterLengths: '1¾L',
  twoLengths: '2L',
  twoHalfLengths: '2½L',
  threeLengths: '3L',
  threeHalfLengths: '3½L',
  fourLengths: '4L',
  fiveLengths: '5L',
  sixLengths: '6L',
  sevenLengths: '7L',
  eightLengths: '8L',
  nineLengths: '9L',
  tenLengths: '10L',
  distance: 'Dist'
};

export const MARGIN_TIERS = Object.keys(WIN_MARGIN_POINTS) as Array<MarginTier>;

export function subtotalNote(race: RaceResult, rows: Array<MemberRaceRow>): string {
  const places = [...rows].map((row) => row.place).sort((a, b) => a - b);
  const placesLabel = places.join('·');

  if (race.teamBonusPoints === 5_000) return `${placesLabel} sweep — podium +5,000`;
  if (race.teamBonusPoints === 4_000) return `${placesLabel} — top-5 bonus +4,000`;
  if (race.teamBonusPoints === 3_000) return `${placesLabel} — podium pair +3,000`;
  return placesLabel;
}
