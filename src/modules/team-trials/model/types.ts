import type { UmaAptitudes } from '@/modules/data/services/UmaService';

export const ROSTER_CATEGORIES = ['sprint', 'mile', 'medium', 'long', 'dirt'] as const;

export type RosterCategory = (typeof ROSTER_CATEGORIES)[number];

export type RosterMember = {
  outfitId: string;
  charId: string;
  fit: number;
  surface: string;
  distance: string;
  style: keyof UmaAptitudes;
  stars: number;
  potential: number;
  uniqueProcPoints: number;
  isAce: boolean;
};

export type Roster = Record<RosterCategory, Array<RosterMember>>;

export type Candidate = RosterMember & {
  aceStyleRate: number;
  isPinned: boolean;
};

export type CandidateRoster = Record<RosterCategory, Array<Candidate>>;

export function emptyRoster(): CandidateRoster {
  return {
    sprint: [],
    mile: [],
    medium: [],
    long: [],
    dirt: []
  };
}
