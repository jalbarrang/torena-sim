// TypeScript mirrors of the WASM boundary DTOs (see
// `packages/uma-sim-wasm/src/dto.rs`). Enums cross the boundary as the same
// numeric codes the app already uses; keys are camelCase.

type WasmCorner = { start: number; length: number };
type WasmStraight = { start: number; end: number; frontType?: number };
type WasmSlope = { start: number; length: number; slope: number };

export type WasmCourseData = {
  courseId: number;
  raceTrackId: number;
  distance: number;
  distanceType: number; // 1 short, 2 mile, 3 mid, 4 long
  surface: number; // 1 turf, 2 dirt
  turn: number; // 1 cw, 2 ccw, 3 unused, 4 none
  courseSetStatus?: number[]; // 1..5 (speed..wit)
  corners?: WasmCorner[];
  straights?: WasmStraight[];
  slopes?: WasmSlope[];
  laneMax: number;
  courseWidth: number;
  horseLane: number;
  laneChangeAcceleration: number;
  laneChangeAccelerationPerFrame: number;
  maxLaneDistance: number;
  moveLanePoint: number;
  isAbroad?: boolean;
};

type WasmStatLine = {
  speed: number;
  stamina: number;
  power: number;
  guts: number;
  wit: number;
};

type WasmAptitudes = {
  distance: number; // 0 S, 1 A, .. 7 G
  strategy: number;
  surface: number;
};

type WasmRawEffect = {
  modifier: number; // raw x10000 units
  target: number; // numeric SkillTarget
  type: number; // numeric SkillType
  valueUsage?: number;
  valueLevelUsage?: number;
};

type WasmSkillAlternative = {
  baseDuration: number; // raw x10000 units
  cooldownTime?: number;
  condition: string;
  precondition?: string;
  effects: WasmRawEffect[];
};

export type WasmSkillInput = {
  skillId: string;
  rarity: number; // 1 white, 2 gold, 3/4/5 unique, 6 evolution
  tags: number[];
  alternatives: WasmSkillAlternative[];
};

type WasmForcedRegion = { start: number; end: number };
type WasmForcedRank = { start: number; end: number; rank: number };
type WasmInjectedDebuff = { skill: WasmSkillInput; position: number };

export type WasmCreateRunner = {
  outfitId: string;
  name: string;
  mood: number; // -2..2
  strategy: number; // 1 front, 2 pace, 3 late, 4 end, 5 runaway
  popularity?: number; // betting rank (1 = most popular); 0/omitted = unknown
  team?: number; // CM/LoH team grouping (1-based); omitted = no team
  aptitudes: WasmAptitudes;
  stats: WasmStatLine;
  skills?: WasmSkillInput[];
  forcedPositions?: Record<string, number>;
  injectedDebuffs?: WasmInjectedDebuff[];
  forcedRushedRegions?: WasmForcedRegion[];
  forcedDuelingRegions?: WasmForcedRegion[];
  forcedSpotStruggleRegions?: WasmForcedRegion[];
  forcedRank?: WasmForcedRank[];
};

export type WasmRaceParameters = {
  ground: number; // 1 firm .. 4 heavy
  weather: number;
  season: number;
  timeOfDay: number;
  grade: number; // 100 G1 .. 999 daily
};

export type WasmSettings = {
  mode?: 'normal' | 'compare';
  healthSystem?: boolean;
  rushed?: boolean;
  /** Per-runner rushed settings, in runner insertion order. */
  rushedRunners?: boolean[];
  downhill?: boolean;
  conservePower?: boolean;
  spotStruggle?: boolean;
  dueling?: boolean;
  witChecks?: boolean;
  skillSamples?: number;
  sectionModifier?: boolean;
  positionKeepMode?: number;
  staminaDrainOverrides?: Record<string, number>;
};

export type WasmDuelingRates = {
  runaway: number;
  frontRunner: number;
  paceChaser: number;
  lateSurger: number;
  endCloser: number;
};

export type WasmCompareParams = {
  course: WasmCourseData;
  parameters: WasmRaceParameters;
  settings?: WasmSettings;
  duelingRates?: WasmDuelingRates;
  runners: WasmCreateRunner[];
  nsamples: number;
  masterSeed: number;
};

export type WasmContestedCompareParams = {
  course: WasmCourseData;
  parameters: WasmRaceParameters;
  settings?: WasmSettings;
  runners: WasmCreateRunner[];
  /** Pad the field with generated mobs to exactly this many runners (runners.length..=12). */
  fillTo?: number;
  /** @deprecated Legacy shim: `true` maps to `fillTo: 9` when `fillTo` is absent. Use `fillTo`. */
  fillMobs?: boolean;
  /** Flat stat line for fill mobs. Omit for the engine default (600). */
  mobStats?: number;
  nsamples: number;
  masterSeed: number;
};

export type WasmRaceSimParams = {
  course: WasmCourseData;
  parameters: WasmRaceParameters;
  settings?: WasmSettings;
  runners: WasmCreateRunner[];
  nsamples: number;
  masterSeed: number;
  focusRunnerIds?: number[];
};

type WasmFinishEntry = {
  runnerId: number;
  name: string;
  strategy: number;
  finishPosition: number;
  finishTime: number;
};

type WasmTickSample = {
  time: number;
  position: number;
  speed: number;
  lane: number;
  health: number;
};

type WasmFocusTrace = {
  runnerId: number;
  samples: WasmTickSample[];
  /** Self-cast skill-effect duration logs, keyed by skill id (JS object, not a Map). */
  skillActivations: Record<string, WasmSkillEffectLog[]>;
};
type WasmRoundData = { seed: number; focus: WasmFocusTrace[] };

type WasmRaceEventDetail = {
  skillId?: string;
  otherRunnerIds?: number[];
  finishPlace?: number;
  finishTime?: number;
};

// `kind` is a kebab-case string matching the TS RaceEventKind union.
type WasmRaceEvent = {
  kind: string;
  runnerId: number;
  position: number;
  tick: number;
  detail?: WasmRaceEventDetail;
};

export type WasmRaceSimResult = {
  finishOrders: WasmFinishEntry[][];
  collected: WasmRoundData[];
  eventLogs: WasmRaceEvent[][];
};

// `perspective` is numeric (1 = self, 2 = other), matching TS `SkillPerspective`.
export type WasmSkillEffectLog = {
  executionId: string;
  skillId: string;
  start: number;
  end: number;
  perspective: number;
  effectType: number;
  effectTarget: number;
};

export type WasmCompareRoundData = {
  runnerId: number;
  time: number[];
  position: number[];
  velocity: number[];
  hp: number[];
  currentLane: number[];
  pacerGap: number[];
  order: number[];
  skillActivations: Record<string, WasmSkillEffectLog[]>;
  targetedSkillActivations: Record<string, WasmSkillEffectLog[]>;
  startDelay: number;
  rushed: [number, number][];
  duelingRegion?: [number, number];
  spotStruggleRegion?: [number, number];
  fullyChargedRegion?: [number, number];
  fullyChargedAccel?: number;
  hasAchievedFullSpurt: boolean;
  outOfHp: boolean;
  outOfHpPosition?: number;
  nonFullSpurtVelocityDiff?: number;
  nonFullSpurtDelayDistance?: number;
  firstPositionInLateRace: boolean;
  usedSkills: string[];
  finished: boolean;
  finishPosition: number;
};

type WasmCompareRound = {
  seed: number;
  primaryRunnerId?: number;
  runners: WasmCompareRoundData[];
};

export type WasmCompareData = {
  rounds: WasmCompareRound[];
};

// Per-tick snapshot passed to the streaming `setOnAfterRunnerTick` callback.
export type RunnerTickSnapshot = {
  runnerId: number;
  time: number;
  position: number;
  speed: number;
  lane: number;
  health: number;
  finished: boolean;
};
