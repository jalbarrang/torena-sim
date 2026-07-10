import { cloneDeep } from 'es-toolkit';
import type {
  SkillSimulationData,
  SkillTrackedMetaCollection
} from '@/modules/simulation/compare.types';
import type {
  SkillComparisonResponse,
  SkillComparisonRoundResult
} from '@/modules/simulation/types';

export const mergeSkillResults = (
  resultA: SkillComparisonRoundResult,
  resultB: SkillComparisonRoundResult
) => {
  const countA = resultA.results.length;
  const countB = resultB.results.length;

  const combinedResults = resultA.results.concat(resultB.results).toSorted((a, b) => a - b);

  const combinedMean = (resultA.mean * countA + resultB.mean * countB) / (countA + countB);
  const mid = Math.floor(combinedResults.length / 2);
  const newMedian =
    combinedResults.length % 2 == 0
      ? (combinedResults[mid - 1] + combinedResults[mid]) / 2
      : combinedResults[mid];

  const selectedRunData = countB > countA ? resultB.runData : resultA.runData;
  const minrun = resultA.min < resultB.min ? resultA.runData.minrun : resultB.runData.minrun;
  const maxrun = resultA.max > resultB.max ? resultA.runData.maxrun : resultB.runData.maxrun;

  // Replace runs wholesale. A deep merge would splice the two runs' arrays
  // together element-wise (skill logs, telemetry series), corrupting them.
  const mergedRunData: SkillSimulationData = {
    ...selectedRunData,
    minrun,
    maxrun
  };

  // Properly merge skillActivations by concatenating arrays instead of replacing by index
  const activations: Record<string, SkillTrackedMetaCollection> = cloneDeep(
    resultA.skillActivations
  );

  for (const [skillId, newActivations] of Object.entries(resultB.skillActivations)) {
    const existingActivations = activations[skillId];
    if (existingActivations) {
      activations[skillId] = existingActivations.concat(newActivations);
    } else {
      // Add new skill activations

      activations[skillId] = newActivations;
    }
  }

  return {
    id: resultA.id,

    results: combinedResults,
    runData: mergedRunData,
    skillActivations: activations,

    min: Math.min(resultA.min, resultB.min),
    max: Math.max(resultA.max, resultB.max),
    mean: combinedMean,
    median: newMedian,

    filterReason: resultB.filterReason ?? resultA.filterReason
  };
};

const mergeResultSets = (
  resultSetA: SkillComparisonResponse,
  resultSetB: SkillComparisonResponse
) => {
  for (const [id, resultB] of Object.entries(resultSetB)) {
    const resultA = resultSetA[id];

    if (resultA) {
      resultSetA[id] = mergeSkillResults(resultA, resultB);
    }
  }
};

const calculateStagesFor = (length: number) => {
  if (length > 100) {
    return [3, 10, 30, 100];
  }

  return [5, 15, 50, 200];
};
