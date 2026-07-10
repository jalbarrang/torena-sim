export const Mood = {
  Awful: -2,
  Bad: -1,
  Normal: 0,
  Good: 1,
  Great: 2
} as const;
export type IMood = (typeof Mood)[keyof typeof Mood];
export const moods = Object.values(Mood);

export const Aptitude = {
  S: 0,
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  E: 5,
  F: 6,
  G: 7
} as const;
export type IAptitude = (typeof Aptitude)[keyof typeof Aptitude];
export const AptitudeName = {
  [Aptitude.S]: 'S',
  [Aptitude.A]: 'A',
  [Aptitude.B]: 'B',
  [Aptitude.C]: 'C',
  [Aptitude.D]: 'D',
  [Aptitude.E]: 'E',
  [Aptitude.F]: 'F',
  [Aptitude.G]: 'G'
} as const;
export const aptitudeNames = Object.values(AptitudeName);

export const Strategy = {
  FrontRunner: 1,
  PaceChaser: 2,
  LateSurger: 3,
  EndCloser: 4,
  Runaway: 5
} as const;
export type IStrategy = (typeof Strategy)[keyof typeof Strategy];
export const strategies = Object.values(Strategy);
export const StrategyName = {
  [Strategy.FrontRunner]: 'Front Runner',
  [Strategy.PaceChaser]: 'Pace Chaser',
  [Strategy.LateSurger]: 'Late Surger',
  [Strategy.EndCloser]: 'End Closer',
  [Strategy.Runaway]: 'Runaway'
} as const;
export type IStrategyName = (typeof StrategyName)[keyof typeof StrategyName];
export const strategyNames = Object.values(StrategyName);
