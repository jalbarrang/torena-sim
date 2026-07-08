import { cloneDeep } from 'es-toolkit';
import type { ISkillPerspective, ISkillTarget, ISkillType } from '@/lib/uma-domain/skills/definitions';

export type CompareRunnerId = 'uma1' | 'uma2';

export interface CompareResult {
  results: Array<number>;
  runData: SimulationData;
  rushedStats: Stats;
  fullyChargedStats: Stats;
  leadCompetitionStats: Stats;
  duelingStats: Stats;
  spurtInfo: null;
  staminaStats: StaminaStats;
  firstUmaStats: FirstUMAStats;
}

export interface FirstUMAStats {
  uma1: FirstUMAStatsUma1;
  uma2: FirstUMAStatsUma1;
}

interface FirstUMAStatsUma1 {
  firstPlaceRate: number;
}

export interface Stats {
  uma1: LeadCompetitionStatsUma1;
  uma2: LeadCompetitionStatsUma1;
}

interface LeadCompetitionStatsUma1 {
  min: number;
  max: number;
  mean: number;
  frequency: number;
}

export interface SimulationData {
  minrun: SimulationRun;
  maxrun: SimulationRun;
  meanrun: SimulationRun;
  medianrun: SimulationRun;
}

/**
 * Data for a skill comparison simulation
 */
export type SkillSimulationData = {
  /**
   * Minimum simulation run data
   */
  minrun: SkillSimulationRun;
  /**
   * Maximum simulation run data
   */
  maxrun: SkillSimulationRun;
  /**
   * Mean simulation run data
   */
  meanrun: SkillSimulationRun;
  /**
   * Median simulation run data
   */
  medianrun: SkillSimulationRun;
};

/**
 * Data for a single simulation run
 */
export interface SimulationRun {
  /**
   * Current Delta Time (in seconds) for each uma
   */
  time: Array<Array<number>>;
  /**
   * Current Position (in meters) for each uma for each time step
   */
  position: Array<Array<number>>;
  /**
   * Current Velocity (in meters per second) for each uma for each time step
   */
  velocity: Array<Array<number>>;
  /**
   * Current HP for each uma for each time step
   */
  hp: Array<Array<number>>;
  /**
   * Current Lane (0-2) for each uma for each time step
   */
  currentLane: Array<Array<number>>;
  /**
   * Current Gap (in meters) between the uma and the pacer for each time step
   */
  pacerGap: Array<Array<number>>;
  /**
   * Skill Activations for each uma
   */
  skillActivations: [SkillActivationMap, SkillActivationMap];
  /**
   * Targeted (debuff) skill activations for each uma — separated from self-skill activations.
   */
  targetedSkillActivations: [SkillActivationMap, SkillActivationMap];
  /**
   * Start Delay (in seconds) for each uma
   */
  startDelay: Array<number>;
  /**
   * Rushed Mode positions for each uma
   */
  rushed: Array<Array<RegionActivation>>;
  /**
   * Dueling Regions for each uma
   */
  duelingRegions: Array<RegionActivation | []>;
  /**
   * Spot Struggle Regions for each uma
   */
  spotStruggleRegions: Array<RegionActivation | []>;
  /**
   * Fully Charged release regions for each uma
   */
  fullyChargedRegions: Array<RegionActivation | []>;
  /**
   * Fully Charged accel bonus for each uma
   */
  fullyChargedAccel: Array<number | null>;
}

export interface SkillSimulationRun {
  sk: [SkillActivationMap, SkillActivationMap];
}

// [RegionStart, RegionEnd]
type RegionActivation = [number, number];

/**
 * Metadata for tracking skill activations
 *
 * this type takes care to store data used for skill comparison simulation purposes
 */
export type SkillTrackedMeta = {
  /**
   * The length of the horse gained from the skill, recorded at the end of the race.
   */
  horseLength: number;
  /**
   * The positions this skill was activated at
   */
  positions: Array<number>;
};

export type SkillTrackedMetaCollection = Array<SkillTrackedMeta>;

export type SkillEffectLog = {
  executionId: string;
  skillId: string;
  start: number;
  end: number;
  perspective: ISkillPerspective;
  effectType: ISkillType;
  effectTarget: ISkillTarget;
};

export type SkillActivationMap = Record<string, Array<SkillEffectLog>>;

export interface StaminaStats {
  uma1: StaminaStatsUma1;
  uma2: StaminaStatsUma1;
}

interface StaminaStatsUma1 {
  staminaSurvivalRate: number;
  fullSpurtRate: number;
}

const defaultSimulationRun: SimulationRun = {
  time: [[], []],
  position: [[], []],
  velocity: [[], []],
  hp: [[], []],
  currentLane: [[], []],
  pacerGap: [[], []],
  skillActivations: [{}, {}],
  targetedSkillActivations: [{}, {}],
  startDelay: [0, 0],
  rushed: [[], []],
  duelingRegions: [[], []],
  spotStruggleRegions: [[], []],
  fullyChargedRegions: [[], []],
  fullyChargedAccel: [null, null]
};

export const initializeSimulationRun = (
  simulationRun: Partial<SimulationRun> = {}
): SimulationRun => ({
  ...cloneDeep(defaultSimulationRun),
  ...simulationRun
});

export const initializeSkillSimulationRun = (
  skillSimulationRun: Partial<SkillSimulationRun> = {}
): SkillSimulationRun => ({
  sk: [{}, {}],
  ...skillSimulationRun
});
