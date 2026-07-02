import { useEffect, useMemo, useRef } from 'react';
import CompareWasmWorker from '@workers/simulator-wasm.worker.ts?worker';
import type { CompareParams } from '../../types';
import type { CompareResult } from '@/modules/simulation/compare.types';
import {
  setIsCompareSimRunning,
  setResults,
  setSimulationProgress,
  useCompareSettings
} from '@/modules/simulation/stores/compare.store';
import { racedefToParams } from '@/utils/races';
import { useSettingsStore, useWitVariance } from '@/store/settings.store';
import { useComparePairRunners, useRunners } from '@/store/runners.store';
import { useDebuffs } from '@/modules/simulation/stores/compare.store';
import { useForcedPositions } from '@/modules/simulation/stores/forced-positions.store';
import {
  useScenarioOverrides,
  hasAnyScenarioOverrides
} from '@/modules/simulation/stores/scenario-overrides.store';
import { coursesService } from '@/modules/data/services/CourseService';
import { buildComparePlan } from '@/modules/simulation/simulators/wasm-compare-plan';

const createCompareWorker = () => new CompareWasmWorker();

type WorkerMessage<T> =
  | {
      type: 'worker-error';
      error: string;
    }
  | {
      type: 'compare';
      results: T;
    }
  | {
      type: 'compare-complete';
    }
  | {
      type: 'compare-progress';
      currentSamples: number;
      totalSamples: number;
    };

export function useSimulationRunner() {
  const { uma1, uma2 } = useComparePairRunners();
  const allRunners = useRunners();
  const contextRunners = useMemo(
    () => allRunners.filter((r) => r.fieldId !== uma1.fieldId && r.fieldId !== uma2.fieldId),
    [allRunners, uma1.fieldId, uma2.fieldId]
  );

  const { racedef, nsamples, courseId, staminaDrainOverrides } = useSettingsStore();

  const {
    simWitVariance,
    allowRushedUma1,
    allowRushedUma2,
    allowDownhillUma1,
    allowDownhillUma2,
    allowConservePowerUma1,
    allowConservePowerUma2,
    allowSectionModifierUma1,
    allowSectionModifierUma2,
    allowSkillCheckChanceUma1,
    allowSkillCheckChanceUma2
  } = useWitVariance();

  const { uma1: forcedUma1, uma2: forcedUma2 } = useForcedPositions();
  const { uma1: debuffsUma1, uma2: debuffsUma2 } = useDebuffs();
  const { compareMode, fieldSize } = useCompareSettings();
  const scenarioOverrides = useScenarioOverrides();

  const webWorkerRef = useRef<Worker | null>(null);

  const handleWorkerMessage = <T>(event: MessageEvent<WorkerMessage<T>>) => {
    const { type } = event.data;

    console.log('compare:handleWorkerMessage', {
      type,
      data: event.data
    });

    switch (type) {
      case 'compare':
        setResults(event.data.results as CompareResult);
        break;
      case 'compare-progress':
        setSimulationProgress({
          current: event.data.currentSamples,
          total: event.data.totalSamples
        });
        break;
      case 'compare-complete':
        setIsCompareSimRunning(false);
        setSimulationProgress(null);
        break;
      case 'worker-error':
        console.error('Compare worker error:', event.data.error);
        setIsCompareSimRunning(false);
        setSimulationProgress(null);
        break;
    }
  };

  useEffect(() => {
    const webWorker = createCompareWorker();

    webWorker.addEventListener('message', handleWorkerMessage);

    webWorkerRef.current = webWorker;
    return () => {
      webWorker.removeEventListener('message', handleWorkerMessage);
      webWorker.terminate();
      webWorkerRef.current = null;
    };
  }, []);

  const course = useMemo(() => coursesService.getSimCourse(courseId), [courseId]);

  const handleRunCompare = (seed?: number) => {
    setIsCompareSimRunning(true);
    setSimulationProgress(null);

    // Generate random seed if not provided
    const simulationSeed = seed ?? Math.floor(Math.random() * 1000000);

    const hasForcedPositions =
      Object.keys(forcedUma1).length > 0 || Object.keys(forcedUma2).length > 0;
    const hasDebuffs = debuffsUma1.length > 0 || debuffsUma2.length > 0;
    const hasOverrides =
      hasAnyScenarioOverrides(scenarioOverrides.uma1) ||
      hasAnyScenarioOverrides(scenarioOverrides.uma2);

    const params: CompareParams = {
      nsamples,
      course,
      racedef: racedefToParams(racedef),
      uma1: uma1,
      uma2: uma2,
      options: {
        seed: simulationSeed,
        allowRushedUma1: simWitVariance ? allowRushedUma1 : false,
        allowRushedUma2: simWitVariance ? allowRushedUma2 : false,
        allowDownhillUma1: simWitVariance ? allowDownhillUma1 : false,
        allowDownhillUma2: simWitVariance ? allowDownhillUma2 : false,
        allowConservePowerUma1,
        allowConservePowerUma2,
        allowSectionModifierUma1: simWitVariance ? allowSectionModifierUma1 : false,
        allowSectionModifierUma2: simWitVariance ? allowSectionModifierUma2 : false,
        useEnhancedSpurt: false,
        accuracyMode: false,
        skillCheckChanceUma1: simWitVariance ? allowSkillCheckChanceUma1 : false,
        skillCheckChanceUma2: simWitVariance ? allowSkillCheckChanceUma2 : false,
        staminaDrainOverrides
      },
      forcedPositions: hasForcedPositions ? { uma1: forcedUma1, uma2: forcedUma2 } : undefined,
      injectedDebuffs: hasDebuffs ? { uma1: debuffsUma1, uma2: debuffsUma2 } : undefined,
      scenarioOverrides: hasOverrides ? scenarioOverrides : undefined
    };

    const worker = webWorkerRef.current;
    if (!worker) {
      setIsCompareSimRunning(false);
      return;
    }

    // Resolve skills/uma data into a data-free plan on the main thread; the
    // worker never touches the dataset.
    worker.postMessage({
      type: 'compare',
      data: buildComparePlan(params, { mode: compareMode, fieldSize, contextRunners })
    });
  };

  function handleRunOnce(seed?: number) {
    setIsCompareSimRunning(true);
    setSimulationProgress(null);

    // Generate random seed if not provided
    const simulationSeed = seed ?? Math.floor(Math.random() * 1000000);

    const hasForcedPositions =
      Object.keys(forcedUma1).length > 0 || Object.keys(forcedUma2).length > 0;
    const hasDebuffs = debuffsUma1.length > 0 || debuffsUma2.length > 0;
    const hasOverrides =
      hasAnyScenarioOverrides(scenarioOverrides.uma1) ||
      hasAnyScenarioOverrides(scenarioOverrides.uma2);

    const params: CompareParams = {
      nsamples: 1,
      course,
      racedef: racedefToParams(racedef),
      uma1: uma1,
      uma2: uma2,
      options: {
        seed: simulationSeed,
        allowRushedUma1: simWitVariance ? allowRushedUma1 : false,
        allowRushedUma2: simWitVariance ? allowRushedUma2 : false,
        allowDownhillUma1: simWitVariance ? allowDownhillUma1 : false,
        allowDownhillUma2: simWitVariance ? allowDownhillUma2 : false,
        allowConservePowerUma1,
        allowConservePowerUma2,
        allowSectionModifierUma1: simWitVariance ? allowSectionModifierUma1 : false,
        allowSectionModifierUma2: simWitVariance ? allowSectionModifierUma2 : false,
        useEnhancedSpurt: false,
        accuracyMode: false,
        skillCheckChanceUma1: simWitVariance ? allowSkillCheckChanceUma1 : false,
        skillCheckChanceUma2: simWitVariance ? allowSkillCheckChanceUma2 : false,
        staminaDrainOverrides
      },
      forcedPositions: hasForcedPositions ? { uma1: forcedUma1, uma2: forcedUma2 } : undefined,
      injectedDebuffs: hasDebuffs ? { uma1: debuffsUma1, uma2: debuffsUma2 } : undefined,
      scenarioOverrides: hasOverrides ? scenarioOverrides : undefined
    };

    const worker = webWorkerRef.current;
    if (!worker) {
      setIsCompareSimRunning(false);
      return;
    }

    worker.postMessage({
      type: 'compare',
      data: buildComparePlan(params, { mode: compareMode, fieldSize, contextRunners })
    });
  }

  return { handleRunCompare, handleRunOnce };
}
