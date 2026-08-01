import type { CourseData } from '@/lib/uma-domain/course/definitions';
import type { RaceParameters } from '@/lib/uma-domain/race/types';
import type { IRunnerState } from '@/modules/runners/components/runner-card/domain/runner-state';
import type { SimulationOptions, SkillComparisonResponse } from '@/modules/simulation/types';
import type { SkillSamplingPlan } from '@/modules/simulation/simulators/wasm-skill-compare';

export type WorkerState = 'idle' | 'busy' | 'terminated';

export type SimulationProgress = {
  currentStage: 1 | 2 | 3;
  totalStages: 3;
  skillsCompletedInStage: number;
  totalSkillsInStage: number;
};

export type WorkBatch = {
  batchId: number;
  skills: Array<string>;
  stage: 1 | 2 | 3;
  nsamples: number;
};

export type SimulationParams = {
  course: CourseData;
  racedef: RaceParameters;
  uma: IRunnerState;
  options: SimulationOptions;
};

// Messages from main thread to worker
export type WorkerInMessage =
  | {
      type: 'init';
      workerId: number;
      /** Pre-compiled WASM module shared by the pool (skips per-worker compile). */
      compiledModule?: WebAssembly.Module;
    }
  | {
      type: 'work-batch';
      batchId: number;
      // Data-free sampling plan resolved on the main thread (pool-manager) from
      // the batch's skill ids; the worker never touches the dataset.
      plan: SkillSamplingPlan;
    }
  | { type: 'terminate' };

// Messages from worker to main thread
export type WorkerOutMessage =
  | { type: 'worker-ready'; workerId: number }
  | {
      type: 'batch-complete';
      workerId: number;
      batchId: number;
      results: SkillComparisonResponse;
    }
  | { type: 'request-work'; workerId: number }
  | { type: 'worker-error'; workerId: number; error: string };

// Skill Basin specific messages
type SkillBasinWorkerInMessage = WorkerInMessage;
type SkillBasinWorkerOutMessage = WorkerOutMessage;

// Uma Basin specific messages
type UmaBasinWorkerInMessage = WorkerInMessage;
type UmaBasinWorkerOutMessage = WorkerOutMessage;
