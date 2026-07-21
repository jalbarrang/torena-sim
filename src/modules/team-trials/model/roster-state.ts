import type { MemberRaceRow } from './score-sheet';
import { ROSTER_CATEGORIES, type Roster, type RosterCategory } from './types';

export type RosterStateSlices = {
  assignments: Partial<Record<RosterCategory, Array<string>>>;
  aces: Partial<Record<RosterCategory, string>>;
  sheetOverrides: Partial<Record<RosterCategory, Array<MemberRaceRow>>>;
};

function rosterForTeamSize(roster: Roster, teamSize: number): Roster {
  return Object.fromEntries(
    ROSTER_CATEGORIES.map((category) => [category, roster[category].slice(0, teamSize)])
  ) as Roster;
}

/**
 * Keeps the materialized roster's existing slot order when a class reduces team size.
 * This deliberately follows buildRoster's first-valid-assignment-wins rule rather than ranking again.
 */
export function pruneRosterForTeamSize(
  state: RosterStateSlices,
  roster: Roster,
  teamSize: number
): RosterStateSlices {
  const narrowedRoster = rosterForTeamSize(roster, teamSize);

  const next: RosterStateSlices = { assignments: {}, aces: {}, sheetOverrides: {} };

  for (const category of ROSTER_CATEGORIES) {
    const members = narrowedRoster[category];
    const outfitIds = new Set(members.map((member) => member.outfitId));
    const assignments = members.map((member) => member.outfitId);
    const ace = state.aces[category];
    const rows = (state.sheetOverrides[category] ?? []).filter((row) =>
      outfitIds.has(row.outfitId)
    );

    if (assignments.length > 0) next.assignments[category] = assignments;
    if (ace && outfitIds.has(ace)) next.aces[category] = ace;
    if (rows.length > 0) next.sheetOverrides[category] = rows;
  }

  return next;
}
