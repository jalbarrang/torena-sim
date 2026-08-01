/**
 * Skill Planner Optimization — shared parameter/stage types.
 *
 * Engine-agnostic types consumed by the live WASM optimizer
 * (`optimization-engine-wasm.ts`).
 */
import type { CandidateSkill, OptimizationProgress } from './types';
import type { IRunnerState } from '@/modules/runners/components/runner-card/domain/runner-state';
import type { CourseData } from '@/lib/uma-domain/course/definitions';
import type { RaceParameters } from '@/lib/uma-domain/race/types';
import type { SimulationOptions } from '@/modules/simulation/types';

export interface OptimizationParams {
  /** Candidate skills available to purchase */
  candidates: Array<CandidateSkill>;
  /** Skills already owned (cost=0, always in baseline) */
  obtainedSkills: Array<string>;
  /** Available skill points budget */
  budget: number;
  /** If true, planner ignores stamina depletion effects */
  ignoreStaminaConsumption: boolean;
  /** Runner configuration (without skills - they'll be set during simulation) */
  runner: IRunnerState;
  /** Course data */
  course: CourseData;
  /** Race parameters */
  racedef: RaceParameters;
  /** Simulation options */
  options: SimulationOptions;
  /** Callback for progress updates */
  onProgress?: (progress: OptimizationProgress) => void;
}

interface OptimizationStageConfig {
  /** Number of samples for this stage */
  samples: number;
  /** Stage name for logging */
  name: string;
}
