import type { IAptitude, IMood, IStrategy } from './definitions';

export type StatLine = {
  speed: number;
  stamina: number;
  power: number;
  guts: number;
  wit: number;
};

export type RunnerAptitudes = {
  distance: IAptitude;
  strategy: IAptitude;
  surface: IAptitude;
};

export type CreateRunner = {
  outfitId: string;
  mood: IMood;
  strategy: IStrategy;
  aptitudes: RunnerAptitudes;
  stats: StatLine;
  skills: Array<string>;
  gate?: number;
  popularity?: number;
  forcedPositions?: Record<string, number>;
  injectedDebuffs?: Array<{ skillId: string; position: number }>;
  forcedRushedRegions?: Array<{ start: number; end: number }>;
  forcedDuelingRegions?: Array<{ start: number; end: number }>;
  forcedSpotStruggleRegions?: Array<{ start: number; end: number }>;
  forcedRank?: Array<{ start: number; end: number; rank: number }>;
};

// Temporary structural bridge while the deprecated TS engine still compiles
// against domain skill types. The delete-ts-engine plan removes that engine,
// after which this can be narrowed around live parser consumers only.
export type Runner = any;

const adjustOvercap = (stat: number): number =>
  stat > 1200 ? 1200 + Math.floor((stat - 1200) / 2) : stat;

const calculateMoodCoefficient = (mood: IMood): number => 1 + 0.02 * mood;

export const buildBaseStats = (stats: StatLine, mood: IMood): StatLine => {
  const moodCoefficient = calculateMoodCoefficient(mood);

  return {
    speed: adjustOvercap(stats.speed) * moodCoefficient,
    stamina: adjustOvercap(stats.stamina) * moodCoefficient,
    power: adjustOvercap(stats.power) * moodCoefficient,
    guts: adjustOvercap(stats.guts) * moodCoefficient,
    wit: adjustOvercap(stats.wit) * moodCoefficient
  };
};
