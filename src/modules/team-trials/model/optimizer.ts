import type { UmaAptitudes } from '@/modules/data/services/UmaService';
import type { UmaSearchEntry } from '@/modules/runners/utils';
import type { OwnedTrainee } from '@/store/trainee-list.store';
import {
  RUNNING_STYLE_EVALUATION_RATES,
  SURFACE_AND_DISTANCE_EVALUATION_RATES,
  UNIQUE_SKILL_PROC_POINTS,
  type AptitudeGrade
} from './scoring-tables';
import {
  emptyRoster,
  ROSTER_CATEGORIES,
  type Candidate,
  type CandidateRoster,
  type Roster,
  type RosterCategory
} from './types';

export type OptimizeInput = {
  umas: Array<UmaSearchEntry>;
  owned: Record<string, OwnedTrainee>;
  teamSize: 1 | 2 | 3;
  pinned: Record<string, RosterCategory>;
  excluded: Array<string>;
};

const RUNNING_STYLES = ['frontRunner', 'paceChaser', 'lateSurger', 'endCloser'] as const;

function aptitudeRate(
  rates: typeof SURFACE_AND_DISTANCE_EVALUATION_RATES | typeof RUNNING_STYLE_EVALUATION_RATES,
  aptitude: string
): number {
  return rates[aptitude as AptitudeGrade] ?? rates.G;
}

function getBestStyle(aptitudes: UmaAptitudes): { style: keyof UmaAptitudes; rate: number } {
  return RUNNING_STYLES.reduce(
    (best, style) => {
      const rate = aptitudeRate(RUNNING_STYLE_EVALUATION_RATES, aptitudes[style]);
      return rate > best.rate ? { style, rate } : best;
    },
    {
      style: 'frontRunner' as keyof UmaAptitudes,
      rate: aptitudeRate(RUNNING_STYLE_EVALUATION_RATES, aptitudes.frontRunner)
    }
  );
}

function getCategoryDistances(
  category: RosterCategory,
  aptitudes: UmaAptitudes
): { distance: string; rate: number } {
  if (category !== 'dirt') {
    return {
      distance: category,
      rate: aptitudeRate(SURFACE_AND_DISTANCE_EVALUATION_RATES, aptitudes[category])
    };
  }

  const sprintRate = aptitudeRate(SURFACE_AND_DISTANCE_EVALUATION_RATES, aptitudes.sprint);
  const mileRate = aptitudeRate(SURFACE_AND_DISTANCE_EVALUATION_RATES, aptitudes.mile);

  return sprintRate >= mileRate
    ? { distance: 'sprint', rate: sprintRate }
    : { distance: 'mile', rate: mileRate };
}

function getUniqueProcPoints(rarity: number, stars: number): number {
  const baseRarity = rarity <= 1 ? 1 : rarity >= 3 ? 3 : 2;
  const level = Math.min(5, Math.max(1, Math.floor(stars))) as 1 | 2 | 3 | 4 | 5;
  return UNIQUE_SKILL_PROC_POINTS[baseRarity][level];
}

export function makeCandidate(
  uma: UmaSearchEntry,
  owned: OwnedTrainee,
  category: RosterCategory,
  isPinned: boolean
): Candidate {
  const { aptitudes } = uma;
  const surface = category === 'dirt' ? 'dirt' : 'turf';
  const distance = getCategoryDistances(category, aptitudes);
  const style = getBestStyle(aptitudes);
  const surfaceRate = aptitudeRate(SURFACE_AND_DISTANCE_EVALUATION_RATES, aptitudes[surface]);

  return {
    outfitId: uma.id,
    charId: uma.id.slice(0, 4),
    fit: surfaceRate * distance.rate * style.rate,
    surface,
    distance: distance.distance,
    style: style.style,
    stars: owned.stars,
    potential: owned.potential,
    uniqueProcPoints: getUniqueProcPoints(uma.rarity, owned.stars),
    isAce: false,
    aceStyleRate: Math.max(
      aptitudeRate(RUNNING_STYLE_EVALUATION_RATES, aptitudes.frontRunner),
      aptitudeRate(RUNNING_STYLE_EVALUATION_RATES, aptitudes.paceChaser)
    ),
    isPinned
  };
}

/** Value keys only — used to detect genuine ties, where the deterministic id tiebreak shouldn't count. */
function compareCandidateValues(left: Candidate, right: Candidate): number {
  return (
    right.fit - left.fit ||
    right.stars - left.stars ||
    right.potential - left.potential ||
    right.uniqueProcPoints - left.uniqueProcPoints
  );
}

function compareCandidates(left: Candidate, right: Candidate): number {
  return compareCandidateValues(left, right) || left.outfitId.localeCompare(right.outfitId);
}

function compareAceCandidates(left: Candidate, right: Candidate): number {
  return (
    right.stars - left.stars ||
    right.potential - left.potential ||
    right.aceStyleRate - left.aceStyleRate ||
    right.fit - left.fit ||
    left.outfitId.localeCompare(right.outfitId)
  );
}

function isBetterCandidate(next: Candidate, current: Candidate): boolean {
  return compareCandidates(next, current) < 0;
}

function uniqueCandidatesByCharacter(candidates: Array<Candidate>): Array<Candidate> {
  const bestByCharacter = new Map<string, Candidate>();

  for (const candidate of candidates) {
    const current = bestByCharacter.get(candidate.charId);
    if (!current || isBetterCandidate(candidate, current)) {
      bestByCharacter.set(candidate.charId, candidate);
    }
  }

  return [...bestByCharacter.values()].sort(compareCandidates);
}

function findCandidate(
  candidatesByCategory: Record<RosterCategory, Array<Candidate>>,
  category: RosterCategory,
  charId: string
): Candidate | undefined {
  return candidatesByCategory[category].find((candidate) => candidate.charId === charId);
}

function assignPinnedMembers(
  roster: CandidateRoster,
  pinnedCandidates: Array<{ category: RosterCategory; candidate: Candidate }>,
  teamSize: number
): void {
  const usedCharacters = new Set<string>();

  for (const { category, candidate } of pinnedCandidates.sort(
    (left, right) =>
      left.category.localeCompare(right.category) ||
      compareCandidates(left.candidate, right.candidate)
  )) {
    if (usedCharacters.has(candidate.charId) || roster[category].length >= teamSize) {
      continue;
    }

    roster[category].push(candidate);
    usedCharacters.add(candidate.charId);
  }
}

function greedyFill(
  roster: CandidateRoster,
  candidatesByCategory: Record<RosterCategory, Array<Candidate>>,
  teamSize: number
): void {
  const usedCharacters = new Set(
    ROSTER_CATEGORIES.flatMap((category) => roster[category].map((member) => member.charId))
  );
  const available = ROSTER_CATEGORIES.flatMap((category) =>
    candidatesByCategory[category].map((candidate) => ({ category, candidate }))
  ).sort(
    (left, right) =>
      compareCandidates(left.candidate, right.candidate) ||
      left.category.localeCompare(right.category)
  );

  for (let index = 0; index < available.length; index += 1) {
    const { category, candidate } = available[index];
    if (roster[category].length >= teamSize || usedCharacters.has(candidate.charId)) {
      continue;
    }

    // Good Positioning pays per running style, so among exactly tied candidates prefer a style the team doesn't have yet.
    const teamStyles = new Set(roster[category].map((member) => member.style));
    let pick = candidate;

    if (teamStyles.has(candidate.style)) {
      for (
        let alt = index + 1;
        alt < available.length && compareCandidateValues(candidate, available[alt].candidate) === 0;
        alt += 1
      ) {
        const entry = available[alt];
        if (entry.category !== category || usedCharacters.has(entry.candidate.charId)) continue;

        if (!teamStyles.has(entry.candidate.style)) {
          pick = entry.candidate;
          break;
        }
      }
    }

    roster[category].push(pick);
    usedCharacters.add(pick.charId);
  }
}

function localSearch(
  roster: CandidateRoster,
  candidatesByCategory: Record<RosterCategory, Array<Candidate>>,
  teamSize: number
): void {
  let changed = true;

  while (changed) {
    changed = false;
    const assigned = ROSTER_CATEGORIES.flatMap((category) =>
      roster[category].map((candidate, index) => ({ category, candidate, index }))
    );
    const usedCharacters = new Set(assigned.map(({ candidate }) => candidate.charId));

    for (const { category, candidate, index } of assigned) {
      if (candidate.isPinned) continue;

      const replacement = candidatesByCategory[category].find(
        (next) => !usedCharacters.has(next.charId) && isBetterCandidate(next, candidate)
      );
      if (!replacement) continue;

      roster[category][index] = replacement;
      usedCharacters.delete(candidate.charId);
      usedCharacters.add(replacement.charId);
      changed = true;
      break;
    }
    if (changed) continue;

    outer: for (let leftIndex = 0; leftIndex < assigned.length; leftIndex += 1) {
      const left = assigned[leftIndex];
      if (left.candidate.isPinned) continue;

      for (let rightIndex = leftIndex + 1; rightIndex < assigned.length; rightIndex += 1) {
        const right = assigned[rightIndex];
        if (left.category === right.category || right.candidate.isPinned) continue;

        const leftReplacement = findCandidate(
          candidatesByCategory,
          left.category,
          right.candidate.charId
        );
        const rightReplacement = findCandidate(
          candidatesByCategory,
          right.category,
          left.candidate.charId
        );
        if (!leftReplacement || !rightReplacement) continue;

        const currentFit = left.candidate.fit + right.candidate.fit;
        const swappedFit = leftReplacement.fit + rightReplacement.fit;
        if (swappedFit <= currentFit) continue;

        roster[left.category][left.index] = leftReplacement;
        roster[right.category][right.index] = rightReplacement;
        changed = true;
        break outer;
      }
    }

    if (changed) continue;

    for (const category of ROSTER_CATEGORIES) {
      if (roster[category].length >= teamSize) continue;

      const benchCandidate = candidatesByCategory[category].find(
        (candidate) => !usedCharacters.has(candidate.charId)
      );
      if (!benchCandidate) continue;

      roster[category].push(benchCandidate);
      changed = true;
      break;
    }
  }
}

export function markAces(roster: CandidateRoster): Roster {
  return Object.fromEntries(
    ROSTER_CATEGORIES.map((category) => {
      const members = roster[category];
      const ace = [...members].sort(compareAceCandidates)[0];

      return [
        category,
        members.map((member) => ({
          outfitId: member.outfitId,
          charId: member.charId,
          fit: member.fit,
          surface: member.surface,
          distance: member.distance,
          style: member.style,
          stars: member.stars,
          potential: member.potential,
          uniqueProcPoints: member.uniqueProcPoints,
          isAce: member.outfitId === ace?.outfitId
        }))
      ];
    })
  ) as Roster;
}

export function optimizeRoster(input: OptimizeInput): Roster {
  const { excluded, owned, pinned, teamSize, umas } = input;
  const excludedIds = new Set(excluded);
  const ownedUmas = umas
    .filter((uma) => owned[uma.id] && !excludedIds.has(uma.id))
    .sort((left, right) => left.id.localeCompare(right.id));
  const candidatesByCategory = Object.fromEntries(
    ROSTER_CATEGORIES.map((category) => [
      category,
      uniqueCandidatesByCharacter(
        ownedUmas.map((uma) => makeCandidate(uma, owned[uma.id], category, false))
      )
    ])
  ) as Record<RosterCategory, Array<Candidate>>;
  const pinnedCandidates = Object.entries(pinned).flatMap(([outfitId, category]) => {
    const uma = ownedUmas.find((entry) => entry.id === outfitId);
    if (!uma) return [];

    return [{ category, candidate: makeCandidate(uma, owned[uma.id], category, true) }];
  });
  const roster = emptyRoster();

  assignPinnedMembers(roster, pinnedCandidates, teamSize);
  greedyFill(roster, candidatesByCategory, teamSize);
  localSearch(roster, candidatesByCategory, teamSize);

  return markAces(roster);
}
