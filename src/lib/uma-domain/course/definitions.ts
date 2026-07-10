// Phase
const Phase = {
  EarlyRace: 0,
  MidRace: 1,
  LateRace: 2,
  LastSpurt: 3
} as const;
export type IPhase = (typeof Phase)[keyof typeof Phase];
export const phases = Object.values(Phase);

// Surface
export const Surface = {
  Turf: 1,
  Dirt: 2
} as const;
export type ISurface = (typeof Surface)[keyof typeof Surface];
export const surfaces = Object.values(Surface);

// Distance Type
const DistanceType = {
  Short: 1,
  Mile: 2,
  Mid: 3,
  Long: 4
} as const;
export type IDistanceType = (typeof DistanceType)[keyof typeof DistanceType];
export const distances = Object.values(DistanceType);

// Orientation
export const Orientation = {
  Clockwise: 1,
  Counterclockwise: 2,
  UnusedOrientation: 3,
  NoTurns: 4
} as const;
export type IOrientation = (typeof Orientation)[keyof typeof Orientation];
export const orientations = Object.values(Orientation);
export const OrientationName = {
  [Orientation.Clockwise]: 'Clockwise',
  [Orientation.Counterclockwise]: 'Counterclockwise',
  [Orientation.UnusedOrientation]: 'Unused Orientation',
  [Orientation.NoTurns]: 'No Turns'
} as const;

// Weather
export const Weather = {
  Sunny: 1,
  Cloudy: 2,
  Rainy: 3,
  Snowy: 4
} as const;
export type IWeather = (typeof Weather)[keyof typeof Weather];
export const weathers = Object.values(Weather);
export const WeatherName = {
  [Weather.Sunny]: 'Sunny',
  [Weather.Cloudy]: 'Cloudy',
  [Weather.Rainy]: 'Rainy',
  [Weather.Snowy]: 'Snowy'
} as const;

// Ground Condition
export const GroundCondition = {
  Firm: 1,
  Good: 2,
  Soft: 3,
  Heavy: 4
} as const;
export type IGroundCondition = (typeof GroundCondition)[keyof typeof GroundCondition];
export const groundConditions = Object.values(GroundCondition);
export const GroundConditionName = {
  [GroundCondition.Firm]: 'Firm',
  [GroundCondition.Good]: 'Good',
  [GroundCondition.Soft]: 'Soft',
  [GroundCondition.Heavy]: 'Heavy'
} as const;

// Season
export const Season = {
  Spring: 1,
  Summer: 2,
  Autumn: 3,
  Winter: 4,
  Sakura: 5
} as const;
export type ISeason = (typeof Season)[keyof typeof Season];
export const seasons = Object.values(Season);
export const SeasonName = {
  [Season.Spring]: 'Spring',
  [Season.Summer]: 'Summer',
  [Season.Autumn]: 'Autumn',
  [Season.Winter]: 'Winter',
  [Season.Sakura]: 'Sakura'
} as const;

// Time of Day
export const TimeOfDay = {
  NoTime: 0,
  Morning: 1,
  Midday: 2,
  Evening: 3,
  Night: 4
} as const;
export type ITimeOfDay = (typeof TimeOfDay)[keyof typeof TimeOfDay];
export const timeOfDays = Object.values(TimeOfDay);
export const TimeOfDayName = {
  [TimeOfDay.NoTime]: 'No Time',
  [TimeOfDay.Morning]: 'Morning',
  [TimeOfDay.Midday]: 'Midday',
  [TimeOfDay.Evening]: 'Evening',
  [TimeOfDay.Night]: 'Night'
} as const;

// Grade
export const Grade = {
  G1: 100,
  G2: 200,
  G3: 300,
  OP: 400,
  PreOP: 700,
  Maiden: 800,
  Debut: 900,
  Daily: 999
} as const;
export type IGrade = (typeof Grade)[keyof typeof Grade];
export const grades = Object.values(Grade);

// Threshold Stat: Speed=1, Stamina=2, Power=3, Guts=4, Int(Wit)=5
type IThresholdStat = 1 | 2 | 3 | 4 | 5;

// Corner
export type ICorner = {
  start: number;
  length: number;
};

// Straight
type IStraight = {
  start: number;
  end: number;
  frontType?: number;
};

// Slope
type ISlope = {
  start: number;
  length: number;
  slope: number;
};

// Event Type
export const EventType = {
  CM: 0,
  LOH: 1
} as const;
export type IEventType = (typeof EventType)[keyof typeof EventType];

export type CourseData = {
  readonly courseId: number;
  readonly raceTrackId: number;
  readonly distance: number;
  readonly distanceType: IDistanceType;
  readonly surface: ISurface;
  readonly turn: IOrientation;

  // True when the race is held overseas (master.mdb race_track.flag_type == 1).
  // Optional so older course_data snapshots and inline fixtures stay valid.
  readonly isAbroad?: boolean;

  readonly courseSetStatus: ReadonlyArray<IThresholdStat>;

  readonly corners: ReadonlyArray<ICorner>;
  readonly straights: ReadonlyArray<IStraight>;
  readonly slopes: ReadonlyArray<ISlope>;

  readonly laneMax: number;
  readonly courseWidth: number;
  readonly horseLane: number;
  readonly laneChangeAcceleration: number;
  readonly laneChangeAccelerationPerFrame: number;
  readonly maxLaneDistance: number;
  readonly moveLanePoint: number;
};
