import type { IMood, IStrategyName } from '@/lib/uma-domain/runner/definitions';
import { Mood } from '@/lib/uma-domain/runner/definitions';

const defaultRunnerState: IRunnerState = {
  outfitId: '',
  speed: 1200,
  stamina: 1200,
  power: 800,
  guts: 400,
  wisdom: 400,
  strategy: 'Front Runner',
  distanceAptitude: 'A',
  surfaceAptitude: 'A',
  strategyAptitude: 'A',
  mood: Mood.Great,
  skills: [],
  randomMobId: Math.floor(Math.random() * 624) + 8000
};

export const createRunnerState = (props: Partial<IRunnerState> = {}): IRunnerState => ({
  ...defaultRunnerState,
  randomMobId: Math.floor(Math.random() * 624) + 8000,
  ...props
});

export type IRunnerState = {
  outfitId: string;
  speed: number;
  stamina: number;
  power: number;
  guts: number;
  wisdom: number;
  strategy: IStrategyName;
  distanceAptitude: string;
  surfaceAptitude: string;
  strategyAptitude: string;
  mood: IMood;
  skills: Array<string>;
  team?: number | null;
  gate?: number | null;
  rankScore?: number | null;
  star?: number | null;
  popularity?: number | null;
  imported?: boolean;
  skillLevels?: Record<string, number>;
  aptitudes?: RunnerAptitudes;
  randomMobId?: number;
  linkedRunnerId?: string;
};

export type RunnerAptitudes = {
  distanceShort: string;
  distanceMile: string;
  distanceMiddle: string;
  distanceLong: string;
  turf: string;
  dirt: string;
  nige: string;
  senko: string;
  sashi: string;
  oikomi: string;
};
