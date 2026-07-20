import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  defaultRaceSheets,
  type MemberRaceRow,
  type RaceSheet,
  type SheetMultipliers
} from '@/modules/team-trials/model/score-sheet';
import {
  ROSTER_CATEGORIES,
  type Roster,
  type RosterCategory
} from '@/modules/team-trials/model/types';
import {
  GOOD_POSITIONING_MAX_PHASES,
  WIN_MARGIN_POINTS
} from '@/modules/team-trials/model/scoring-tables';

const TEAM_TRIALS_STORE_NAME = 'umalator-team-trials';

export type TeamTrialsState = {
  teamClass: 1 | 2 | 3 | 4 | 5 | 6;
  /** User-assembled roster: outfit ids per category, in slot order. */
  assignments: Partial<Record<RosterCategory, Array<string>>>;
  /** Manual ace pick per category; absent means the automatic (stars, potential) rule applies. */
  aces: Partial<Record<RosterCategory, string>>;
  multipliers: SheetMultipliers;
  sheetOverrides: Partial<Record<RosterCategory, Array<MemberRaceRow>>>;
};

export const defaultTeamTrialsState: TeamTrialsState = {
  teamClass: 1,
  assignments: {},
  aces: {},
  multipliers: {
    supportBonusPct: 0,
    winstreakBonusPct: 0,
    ownRating: 0,
    opponentRating: 0,
    campaignMultiplier: 1
  },
  sheetOverrides: {}
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeTeamClass(value: unknown): TeamTrialsState['teamClass'] {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6
    ? (value as TeamTrialsState['teamClass'])
    : defaultTeamTrialsState.teamClass;
}

function normalizeAssignments(value: unknown): TeamTrialsState['assignments'] {
  if (!isRecord(value)) return {};

  return Object.fromEntries(
    ROSTER_CATEGORIES.flatMap((category) => {
      const outfitIds = value[category];
      if (!Array.isArray(outfitIds)) return [];

      const validIds = [
        ...new Set(
          outfitIds.filter(
            (outfitId): outfitId is string => typeof outfitId === 'string' && outfitId.length > 0
          )
        )
      ];

      return validIds.length > 0 ? [[category, validIds]] : [];
    })
  ) as TeamTrialsState['assignments'];
}

function normalizeAces(value: unknown): TeamTrialsState['aces'] {
  if (!isRecord(value)) return {};

  return Object.fromEntries(
    ROSTER_CATEGORIES.flatMap((category) => {
      const outfitId = value[category];
      return typeof outfitId === 'string' && outfitId.length > 0 ? [[category, outfitId]] : [];
    })
  ) as TeamTrialsState['aces'];
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function normalizeMultipliers(value: unknown): SheetMultipliers {
  if (!isRecord(value)) return defaultTeamTrialsState.multipliers;

  const winstreakBonusPct =
    value.winstreakBonusPct === 2 ||
    value.winstreakBonusPct === 3 ||
    value.winstreakBonusPct === 4 ||
    value.winstreakBonusPct === 5
      ? value.winstreakBonusPct
      : 0;
  const campaignMultiplier =
    value.campaignMultiplier === 1 ||
    value.campaignMultiplier === 1.5 ||
    value.campaignMultiplier === 2 ||
    value.campaignMultiplier === 3
      ? value.campaignMultiplier
      : 1;

  return {
    supportBonusPct: nonNegativeNumber(value.supportBonusPct),
    winstreakBonusPct,
    ownRating: Math.floor(nonNegativeNumber(value.ownRating)),
    opponentRating: Math.floor(nonNegativeNumber(value.opponentRating)),
    campaignMultiplier
  };
}

function normalizeRow(value: unknown): MemberRaceRow | null {
  if (!isRecord(value) || typeof value.outfitId !== 'string' || value.outfitId.length === 0) {
    return null;
  }

  const place =
    typeof value.place === 'number' && Number.isFinite(value.place)
      ? Math.min(12, Math.max(1, Math.floor(value.place)))
      : 1;
  const marginTier: MemberRaceRow['marginTier'] =
    place === 1 &&
    typeof value.marginTier === 'string' &&
    Object.hasOwn(WIN_MARGIN_POINTS, value.marginTier)
      ? (value.marginTier as keyof typeof WIN_MARGIN_POINTS)
      : null;
  const procCount = (proc: unknown) =>
    typeof proc === 'number' && Number.isFinite(proc) ? Math.max(0, Math.floor(proc)) : 0;
  const timeBonus =
    typeof value.timeBonus === 'number' && Number.isFinite(value.timeBonus)
      ? Math.min(2_000, Math.max(0, Math.floor(value.timeBonus)))
      : 0;

  return {
    outfitId: value.outfitId,
    place,
    marginTier,
    whiteProcs: procCount(value.whiteProcs),
    goldProcs: procCount(value.goldProcs),
    inheritedProcs: procCount(value.inheritedProcs),
    goodPositioningPhases: Math.min(
      GOOD_POSITIONING_MAX_PHASES,
      procCount(value.goodPositioningPhases)
    ),
    timeBonus,
    fastStart: value.fastStart === true,
    longShot: value.longShot === true && place === 1,
    rushed: value.rushed === true
  };
}

function normalizeSheetOverrides(
  value: unknown
): Partial<Record<RosterCategory, Array<MemberRaceRow>>> {
  if (!isRecord(value)) return {};

  return Object.fromEntries(
    ROSTER_CATEGORIES.flatMap((category) => {
      const rows = value[category];
      if (!Array.isArray(rows)) return [];

      const validRows = rows.flatMap((row) => {
        const normalized = normalizeRow(row);
        return normalized ? [normalized] : [];
      });

      return validRows.length > 0 ? [[category, validRows]] : [];
    })
  ) as Partial<Record<RosterCategory, Array<MemberRaceRow>>>;
}

export function mergeTeamTrialsState(
  persisted: unknown,
  current: TeamTrialsState
): TeamTrialsState {
  const stored = isRecord(persisted) ? persisted : {};

  return {
    ...current,
    teamClass: normalizeTeamClass(stored.teamClass),
    assignments: normalizeAssignments(stored.assignments),
    aces: normalizeAces(stored.aces),
    multipliers: normalizeMultipliers(stored.multipliers),
    sheetOverrides: normalizeSheetOverrides(stored.sheetOverrides)
  };
}

export const useTeamTrialsStore = create<TeamTrialsState>()(
  persist(() => defaultTeamTrialsState, {
    name: TEAM_TRIALS_STORE_NAME,
    storage: createJSONStorage(() => localStorage),
    merge: mergeTeamTrialsState
  })
);

export function setTeamTrialsClass(teamClass: TeamTrialsState['teamClass']) {
  useTeamTrialsStore.setState({ teamClass });
}

export function addTeamTrialsMember(category: RosterCategory, outfitId: string) {
  useTeamTrialsStore.setState((state) => {
    const current = state.assignments[category] ?? [];
    if (current.includes(outfitId)) return state;

    return { assignments: { ...state.assignments, [category]: [...current, outfitId] } };
  });
}

export function removeTeamTrialsMember(category: RosterCategory, outfitId: string) {
  useTeamTrialsStore.setState((state) => {
    const current = state.assignments[category] ?? [];
    if (!current.includes(outfitId)) return state;

    const aces = { ...state.aces };
    if (aces[category] === outfitId) delete aces[category];

    return {
      assignments: {
        ...state.assignments,
        [category]: current.filter((assignedId) => assignedId !== outfitId)
      },
      aces
    };
  });
}

export function setTeamTrialsAce(category: RosterCategory, outfitId: string | null) {
  useTeamTrialsStore.setState((state) => {
    const aces = { ...state.aces };
    if (outfitId === null) {
      delete aces[category];
    } else {
      aces[category] = outfitId;
    }
    return { aces };
  });
}

export function setTeamTrialsAssignments(assignments: TeamTrialsState['assignments']) {
  useTeamTrialsStore.setState({ assignments: normalizeAssignments(assignments), aces: {} });
}

export function clearTeamTrialsRoster() {
  useTeamTrialsStore.setState({ assignments: {}, aces: {}, sheetOverrides: {} });
}

export function setTeamTrialsMultipliers(multipliers: SheetMultipliers) {
  useTeamTrialsStore.setState({ multipliers: normalizeMultipliers(multipliers) });
}

function rosterOutfitIds(roster: Roster, category: RosterCategory): Set<string> {
  return new Set(roster[category].map((member) => member.outfitId));
}

function rowsForRoster(
  rows: Array<MemberRaceRow>,
  roster: Roster,
  category: RosterCategory
): Array<MemberRaceRow> {
  const outfitIds = rosterOutfitIds(roster, category);
  return rows.filter((row) => outfitIds.has(row.outfitId));
}

export function setTeamTrialsSheetOverride(
  category: RosterCategory,
  rows: Array<MemberRaceRow>,
  roster: Roster
) {
  const normalizedRows = rowsForRoster(
    normalizeSheetOverrides({ [category]: rows })[category] ?? [],
    roster,
    category
  );

  useTeamTrialsStore.setState((state) => ({
    sheetOverrides: {
      ...state.sheetOverrides,
      [category]: normalizedRows
    }
  }));
}

export function resetTeamTrialsSheetOverrides() {
  useTeamTrialsStore.setState({ sheetOverrides: {} });
}

export function applyTeamTrialsSheetOverrides(
  roster: Roster,
  sheetOverrides: Partial<Record<RosterCategory, Array<MemberRaceRow>>>
): Array<RaceSheet> {
  return defaultRaceSheets(roster).map((sheet) => {
    const rowsByOutfitId = new Map(
      rowsForRoster(sheetOverrides[sheet.category] ?? [], roster, sheet.category).map((row) => [
        row.outfitId,
        row
      ])
    );

    return {
      ...sheet,
      rows: sheet.rows.map((row) => rowsByOutfitId.get(row.outfitId) ?? row)
    };
  });
}
