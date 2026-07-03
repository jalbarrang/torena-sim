/**
 * # useSkillPlannerOptimizer Hook
 *
 * Manages the skill planner web worker lifecycle and optimization state.
 *
 * ## Responsibilities
 *
 * - Initialize and cleanup worker
 * - Handle worker messages (progress, result, error)
 * - Update skill planner store state
 * - Provide optimization control functions
 */

import { useEffect, useMemo, useRef } from 'react';
import SkillPlannerWasmWorker from '@workers/skill-planner-wasm.worker.ts?worker';
import {
  createCandidate,
  createNewSeed,
  getObtainedSkills,
  setIsOptimizing,
  setLastOptimizationFingerprint,
  setProgress,
  setResult,
  useSkillPlannerStore
} from '../skill-planner.store';
import type {
  CandidateSkill,
  OptimizationProgress,
  OptimizationResult,
  SkillPlanningMeta
} from '../types';
import { buildOptimizationInputFingerprint } from '../input-fingerprint';
import { getNetCost } from '../cost-calculator';
import { generateCombinations } from '../optimizer';
import { buildPlannerWasmContext } from '@/modules/simulation/simulators/wasm-skill-planner-context';
import { coursesService } from '@/modules/data/services/CourseService';
import { racedefToParams } from '@/utils/races';
import { useSettingsStore } from '@/store/settings.store';
import { defaultSimulationOptions } from '@/components/bassin-chart/utils';
import {
  getUnsatisfiedRepresentativePrerequisiteIds,
  isSkillCoveredByOwnedFamily
} from '../skill-family';

const createSkillPlannerWorker = () => new SkillPlannerWasmWorker();

type WorkerMessage =
  | {
      type: 'worker-error';
      error: string;
    }
  | {
      type: 'skill-planner-progress';
      progress: OptimizationProgress;
    }
  | {
      type: 'skill-planner-result';
      result: OptimizationResult;
    }
  | {
      type: 'skill-planner-done';
    }
  | {
      type: 'skill-planner-error';
      error: string;
    };

function getCurrentOptimizationFingerprint() {
  const {
    runner,
    obtainedSkillIds,
    candidates,
    skillMetaById,
    budget,
    hasFastLearner,
    ignoreStaminaConsumption
  } = useSkillPlannerStore.getState();
  const { courseId, racedef, staminaDrainOverrides } = useSettingsStore.getState();

  return buildOptimizationInputFingerprint({
    budget,
    hasFastLearner,
    ignoreStaminaConsumption,
    courseId,
    racedef,
    runner,
    obtainedSkillIds,
    candidates,
    skillMetaById,
    staminaDrainOverrides
  });
}

export function useSkillPlannerOptimizer() {
  const {
    runner,
    obtainedSkillIds,
    candidates,
    skillMetaById,
    budget,
    hasFastLearner,
    ignoreStaminaConsumption,
    seed
  } = useSkillPlannerStore();
  const { courseId, racedef, staminaDrainOverrides } = useSettingsStore();

  const webWorkerRef = useRef<Worker | null>(null);
  const runFingerprintRef = useRef<string | null>(null);

  // Transform course and race parameters
  const course = useMemo(() => coursesService.getSimCourse(courseId), [courseId]);
  const raceParams = useMemo(() => racedefToParams(racedef), [racedef]);

  // Worker message handler
  const handleWorkerMessage = (event: MessageEvent<WorkerMessage>) => {
    const { type } = event.data;
    const currentFingerprint = getCurrentOptimizationFingerprint();
    const isCurrentRun =
      runFingerprintRef.current !== null && runFingerprintRef.current === currentFingerprint;

    console.log('skill-planner:handleWorkerMessage', {
      type,
      data: event.data
    });

    switch (type) {
      case 'skill-planner-progress':
        if (!isCurrentRun) {
          break;
        }
        setProgress(event.data.progress);
        break;
      case 'skill-planner-result':
        if (!isCurrentRun) {
          break;
        }
        setResult(event.data.result);
        setLastOptimizationFingerprint(runFingerprintRef.current);
        break;
      case 'skill-planner-done':
        setIsOptimizing(false);
        setProgress(null);
        break;
      case 'skill-planner-error':
        console.error('Optimization error:', event.data.error);
        setIsOptimizing(false);
        setProgress(null);
        setResult(null);
        break;
      case 'worker-error':
        console.error('Skill planner worker error:', event.data.error);
        setIsOptimizing(false);
        setProgress(null);
        setResult(null);
        break;
    }
  };

  // Initialize worker on mount (and when the engine changes)
  useEffect(() => {
    const webWorker = createSkillPlannerWorker();

    webWorker.addEventListener('message', handleWorkerMessage);

    webWorkerRef.current = webWorker;

    return () => {
      webWorker.removeEventListener('message', handleWorkerMessage);
      webWorker.terminate();
      webWorkerRef.current = null;
    };
  }, []);

  const runWithSeed = (seedValue: number) => {
    if (!webWorkerRef.current) {
      console.error('Worker not initialized');
      return;
    }

    setProgress(null);
    setIsOptimizing(true);

    const obtainedSkills = getObtainedSkills();
    const expandedCandidates = expandPrerequisites(candidates, skillMetaById, obtainedSkills);

    runFingerprintRef.current = buildOptimizationInputFingerprint({
      budget,
      hasFastLearner,
      ignoreStaminaConsumption,
      courseId,
      racedef,
      runner,
      obtainedSkillIds,
      candidates,
      skillMetaById,
      staminaDrainOverrides
    });

    // Resolve costs + runner/course/race data into a data-free plan on the main
    // thread; the optimizer worker never touches the dataset.
    const candidatesWithNetCost = Object.values(expandedCandidates).map((candidate) => ({
      ...candidate,
      netCost: getNetCost(candidate, hasFastLearner)
    }));

    // Combination generation needs skill-family data, so it runs on the main
    // thread; the worker receives the ready-made combinations. Filter with
    // family coverage (not raw id equality) so an obtained ○/◎/gold can never
    // be re-offered as a purchase — e.g. owning Firm Conditions ○ must drop the
    // ○ candidate. The worker keeps a cheap exact-match guard as a safety net.
    const filteredCandidates = candidatesWithNetCost.filter(
      (candidate) => !isSkillCoveredByOwnedFamily(candidate.skillId, obtainedSkills)
    );
    const combinations = generateCombinations(filteredCandidates, budget);

    const skillIds = Array.from(
      new Set([...obtainedSkills, ...candidatesWithNetCost.map((candidate) => candidate.skillId)])
    );

    const context = buildPlannerWasmContext({
      runner,
      skillIds,
      course,
      racedef: raceParams,
      ignoreStaminaConsumption,
      options: {
        ...defaultSimulationOptions,
        staminaDrainOverrides,
        seed: seedValue
      }
    });

    webWorkerRef.current?.postMessage({
      type: 'optimize',
      data: {
        candidates: filteredCandidates,
        combinations,
        obtainedSkills,
        budget,
        context
      }
    });
  };

  const handleOptimize = () => {
    const newSeed = createNewSeed();
    runWithSeed(newSeed);
  };

  const handleReplay = () => {
    if (seed === null) return;
    runWithSeed(seed);
  };

  // Cancel optimization
  const handleCancel = () => {
    if (!webWorkerRef.current) {
      return;
    }

    // Terminate and recreate worker
    webWorkerRef.current.terminate();

    const newWorker = createSkillPlannerWorker();
    newWorker.addEventListener('message', handleWorkerMessage);
    webWorkerRef.current = newWorker;

    // Reset state
    setIsOptimizing(false);
    setProgress(null);
  };

  return {
    handleOptimize,
    handleReplay,
    handleCancel
  };
}

/**
 * Expand candidates with their prerequisite tiers (downward only).
 *
 * - Gold → adds white base ○ and upgrade ◎
 * - Upgrade ◎ → adds base ○
 * - Base ○ → no expansion
 *
 * Prerequisites are added using stored skill meta (fallback to hint level 0).
 * Already-present candidates and obtained skills are skipped.
 */
function expandPrerequisites(
  candidates: Record<string, CandidateSkill>,
  skillMetaById: Record<string, SkillPlanningMeta>,
  obtainedSkills: Array<string>
): Record<string, CandidateSkill> {
  const expanded: Record<string, CandidateSkill> = {};

  for (const candidate of Object.values(candidates)) {
    expanded[candidate.skillId] = createCandidate({
      skillId: candidate.skillId,
      hintLevel: skillMetaById[candidate.skillId]?.hintLevel ?? candidate.hintLevel ?? 0
    });

    for (const prereqId of getUnsatisfiedRepresentativePrerequisiteIds(
      candidate.skillId,
      obtainedSkills
    )) {
      if (!expanded[prereqId]) {
        expanded[prereqId] = createCandidate({
          skillId: prereqId,
          hintLevel: skillMetaById[prereqId]?.hintLevel ?? 0
        });
      }
    }
  }

  return expanded;
}
