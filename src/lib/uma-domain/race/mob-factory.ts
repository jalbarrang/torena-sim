import type { CreateRunner, RunnerAptitudes, StatLine } from '../runner/types';
import { Aptitude, Mood, Strategy } from '../runner/definitions';
import type { IMood, IStrategy } from '../runner/definitions';

type MobConfig = {
  strategy: IStrategy;
  stats: StatLine;
  mood: IMood;
  aptitudes: RunnerAptitudes;
};

const DEFAULT_MOB_STRATEGIES: IStrategy[] = [
  Strategy.FrontRunner,
  Strategy.FrontRunner,
  Strategy.PaceChaser,
  Strategy.PaceChaser,
  Strategy.PaceChaser,
  Strategy.LateSurger,
  Strategy.LateSurger,
  Strategy.EndCloser,
  Strategy.EndCloser
];

const DEFAULT_MOB_STATS: StatLine = {
  speed: 800,
  stamina: 800,
  power: 800,
  guts: 800,
  wit: 800
};

const DEFAULT_MOB_APTITUDES: RunnerAptitudes = {
  distance: Aptitude.A,
  strategy: Aptitude.A,
  surface: Aptitude.A
};

function createMobRunners(configs: MobConfig[]): CreateRunner[] {
  return configs.map((config) => ({
    outfitId: '',
    mood: config.mood,
    strategy: config.strategy,
    aptitudes: { ...config.aptitudes },
    stats: { ...config.stats },
    skills: []
  }));
}

export function generateMobField(): CreateRunner[] {
  return createMobRunners(
    DEFAULT_MOB_STRATEGIES.map((strategy) => ({
      strategy,
      stats: { ...DEFAULT_MOB_STATS },
      mood: Mood.Normal,
      aptitudes: { ...DEFAULT_MOB_APTITUDES }
    }))
  );
}
