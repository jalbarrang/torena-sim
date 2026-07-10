import type { RaceParameters } from '@/lib/uma-domain/race/types';
import type {
  IEventType,
  IGrade,
  IGroundCondition,
  ISeason,
  ITimeOfDay,
  IWeather
} from '@/lib/uma-domain/course/definitions';
import type { IMood } from '@/lib/uma-domain/runner/definitions';
import { Mood } from '@/lib/uma-domain/runner/definitions';
import {
  Grade,
  GroundCondition,
  Season,
  TimeOfDay,
  Weather
} from '@/lib/uma-domain/course/definitions';

const ORDER_RANGE_FOR_STRATEGY = {
  ['Front Runner']: [1, 1],
  ['Pace Chaser']: [2, 4],
  'Late Surger': [5, 9],
  'End Closer': [5, 9],
  Runaway: [1, 1]
};

export type RaceConditions = {
  mood: IMood;
  ground: IGroundCondition;
  weather: IWeather;
  season: ISeason;
  time: ITimeOfDay;
  grade: IGrade;
};

const defaultRaceConditions: RaceConditions = {
  mood: Mood.Normal,
  ground: GroundCondition.Firm,
  weather: Weather.Sunny,
  season: Season.Spring,
  time: TimeOfDay.Midday,
  grade: Grade.G1
};

export const createRaceConditions = (conditions: Partial<RaceConditions> = {}): RaceConditions => {
  return {
    ...defaultRaceConditions,
    ...conditions
  };
};

export type RacePreset = {
  id: string;
  name: string;
  type: IEventType;
  date: string;
  courseId: number;
  season: ISeason;
  ground: IGroundCondition;
  weather: IWeather;
  time: ITimeOfDay;
};

export function racedefToParams(
  { ground, weather, season, time, grade }: RaceConditions,
  includeOrder?: string
): RaceParameters {
  let orderForStrategy: [number, number] | undefined = undefined;

  if (includeOrder) {
    orderForStrategy = ORDER_RANGE_FOR_STRATEGY[
      includeOrder as keyof typeof ORDER_RANGE_FOR_STRATEGY
    ] as [number, number];
  }

  return {
    ground: ground,
    weather,
    season,
    timeOfDay: time,
    grade,
    orderRange: orderForStrategy,
    numUmas: 9
  };
}
