import type { UmaSearchEntry } from '@/modules/runners/utils';
import type { OwnedTrainee } from '@/store/trainee-list.store';
import { makeCandidate, markAces } from './optimizer';
import {
  emptyRoster,
  ROSTER_CATEGORIES,
  type Roster,
  type RosterCategory,
  type RosterMember
} from './types';

export function buildRosterMember(
  uma: UmaSearchEntry,
  owned: OwnedTrainee,
  category: RosterCategory
): RosterMember {
  const candidate = makeCandidate(uma, owned, category, false);

  return {
    outfitId: candidate.outfitId,
    charId: candidate.charId,
    fit: candidate.fit,
    surface: candidate.surface,
    distance: candidate.distance,
    style: candidate.style,
    stars: candidate.stars,
    potential: candidate.potential,
    uniqueProcPoints: candidate.uniqueProcPoints,
    isAce: candidate.isAce
  };
}

export type BuildRosterInput = {
  assignments: Partial<Record<RosterCategory, Array<string>>>;
  umas: Array<UmaSearchEntry>;
  owned: Record<string, OwnedTrainee>;
  teamSize: 1 | 2 | 3;
  /** Per-category ace override by outfit id; falls back to the automatic (stars, potential) rule. */
  aces: Partial<Record<RosterCategory, string>>;
};

/** Materializes a user-assembled roster: resolves outfit ids against owned umas, enforces the one-character-one-slot rule and team size, and marks aces. */
export function buildRoster(input: BuildRosterInput): Roster {
  const { aces, assignments, owned, teamSize, umas } = input;
  const umasById = new Map(umas.map((uma) => [uma.id, uma]));
  const usedCharacters = new Set<string>();
  const roster = emptyRoster();

  for (const category of ROSTER_CATEGORIES) {
    for (const outfitId of assignments[category] ?? []) {
      const uma = umasById.get(outfitId);
      const ownedTrainee = owned[outfitId];
      if (!uma || !ownedTrainee) continue;
      if (roster[category].length >= teamSize) break;

      const candidate = makeCandidate(uma, ownedTrainee, category, false);
      if (usedCharacters.has(candidate.charId)) continue;

      roster[category].push(candidate);
      usedCharacters.add(candidate.charId);
    }
  }

  const marked = markAces(roster);

  for (const category of ROSTER_CATEGORIES) {
    const aceOverride = aces[category];
    if (!aceOverride || !marked[category].some((member) => member.outfitId === aceOverride)) {
      continue;
    }

    marked[category] = marked[category].map((member) => ({
      ...member,
      isAce: member.outfitId === aceOverride
    }));
  }

  return marked;
}
