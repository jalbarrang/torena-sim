import type {
  IGrade,
  IGroundCondition,
  ISeason,
  ITimeOfDay,
  IWeather
} from '../course/definitions';
import type { IStrategy } from '../runner/definitions';

export type SimulationSettings = {
  mode: 'compare' | 'normal';
  healthSystem: boolean;
  sectionModifier: boolean;
  rushed: boolean;
  downhill: boolean;
  conservePower?: boolean;
  spotStruggle: boolean;
  dueling: boolean;
  witChecks: boolean;
  positionKeepMode: number;
  staminaDrainOverrides?: Record<string, number>;
};

export type DuelingRates = {
  runaway: number;
  frontRunner: number;
  paceChaser: number;
  lateSurger: number;
  endCloser: number;
};

export type RaceParameters = {
  ground: IGroundCondition;
  weather: IWeather;
  season: ISeason;
  timeOfDay: ITimeOfDay;
  grade: IGrade;
  strategyCounts?: Map<IStrategy, number>;
  commonSkills?: Map<string, number>;
  numUmas?: number;
  [key: string]: any;
};
