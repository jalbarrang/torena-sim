import { useEffect, useMemo, useRef } from 'react';
import UmaBasinPoolWasmWorker from '@workers/pool/uma-basin/uma-basin-wasm.pool.worker.ts?worker';
import type { SkillComparisonResponse } from '@/modules/simulation/types';
import type { IRunnerState } from '@/modules/runners/components/runner-card/domain/runner-state';
import {
  appendResultsToTable,
  resetTable,
  setIsSimulationRunning,
  setMetrics,
  setProgress,
  setTable
} from '@/modules/simulation/stores/uma-basin.store';
import {
  defaultSimulationOptions,
  getNullSkillComparisonRow
} from '@/components/bassin-chart/utils';
import { useRunner } from '@/store/runners.store';
import { useSettingsStore } from '@/store/settings.store';
import { racedefToParams } from '@/utils/races';
import { PoolManager } from '@/workers/pool/pool-manager';
import { coursesService } from '@/modules/data/services/CourseService';
import { skillsService } from '@/modules/data/services/SkillService';
import { useUmaSkillSelectionStore } from '@/modules/simulation/stores/uma-skill-selection.store';

const createUmaBasinPoolWorker = (options: { name: string }) => new UmaBasinPoolWasmWorker(options);

// Lazily memoized: `skillsService` is only populated after the data bootstrap,
// so this must not run at module-init time.
let cachedUniqueSkillIds: Array<string> | null = null;
function getUniqueSkillIds(): Array<string> {
  cachedUniqueSkillIds ??= skillsService.getUniqueSkillIds();
  return cachedUniqueSkillIds;
}

function removeUniqueSkillsFromRunner(uma: IRunnerState): IRunnerState {
  const uniqueSkillIds = getUniqueSkillIds();
  const filteredSkills = uma.skills.filter((skillId) => !uniqueSkillIds.includes(skillId));

  return { ...uma, skills: filteredSkills };
}

export function useUmaBasinPoolRunner() {
  const { runner } = useRunner();
  const { racedef, courseId } = useSettingsStore();

  const poolManagerRef = useRef<PoolManager | null>(null);

  const course = useMemo(() => coursesService.getSimCourse(courseId), [courseId]);

  // Initialize pool manager on mount
  useEffect(() => {
    const poolManager = new PoolManager((workerOptions) => createUmaBasinPoolWorker(workerOptions));

    poolManagerRef.current = poolManager;

    return () => {
      poolManagerRef.current?.terminateWorkers();
    };
  }, []);

  const doBasinnChart = (seed?: number) => {
    if (!poolManagerRef.current) {
      console.error('Pool manager not initialized');
      return;
    }

    setIsSimulationRunning(true);

    const params = racedefToParams(racedef, runner.strategy);

    const filterer = skillsService.createFilterer({ runner, course, raceParams: params });
    const { selectedSkillIds } = useUmaSkillSelectionStore.getState();

    const candidates = filterer.filterCandidates(getUniqueSkillIds(), {
      selectedSkillIds,
      selectionMode: selectedSkillIds.size > 0 ? 'selected-only' : 'all-matching'
    });
    const skills = filterer.probeActivation(candidates);

    const umaWithoutUniques = removeUniqueSkillsFromRunner(runner);
    const uma = umaWithoutUniques;

    // Create placeholder results
    const filler: SkillComparisonResponse = {};
    for (const id of skills) filler[id] = getNullSkillComparisonRow(id);

    resetTable();
    setTable(filler);

    // Generate random seed if not provided
    const simulationSeed = seed ?? Math.floor(Math.random() * 1000000);

    // Run simulation using pool manager
    poolManagerRef.current.run(
      skills,
      {
        course,
        racedef: params,
        uma,
        options: {
          ...defaultSimulationOptions,
          seed: simulationSeed
        }
      },
      {
        onProgress: (results, progress) => {
          appendResultsToTable(results);
          setProgress(progress);
        },
        onStageComplete: (_stage, _results, progress) => {
          setProgress(progress);
        },
        onComplete: (_results, metrics) => {
          setMetrics(metrics);
          setProgress(null);
          setIsSimulationRunning(false);
        },
        onError: (error) => {
          console.error('Pool simulation error:', error);
          setProgress(null);
          setIsSimulationRunning(false);
        }
      }
    );
  };

  const cancelSimulation = () => {
    poolManagerRef.current?.terminateWorkers();
    setIsSimulationRunning(false);
  };

  return { doBasinnChart, cancelSimulation };
}
