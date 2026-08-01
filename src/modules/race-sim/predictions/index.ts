import type { IRunnerState } from '@/modules/runners/components/runner-card/domain/runner-state';
import {
  applyNormalization,
  applyPreRaceAdjustments,
  buildFrontendRoom,
  encodeRoom
} from './featureBuilder';
import { loadRaceRoomModel } from './loader';
import { getRaceRoomModelForCourse } from './registry';
import { predictEncodedRoom } from './runtime';
import { runnersToRaceHorseInfo } from './adapter';
import type { FrontendModel, RaceRoomModelSpec, RaceRoomPredictionResult } from './types';

export type { RaceRoomModelSpec, RaceRoomPredictionResult } from './types';
export { runnersToRaceHorseInfo } from './adapter';

export function getSupportedRaceRoomModel(courseId: number | undefined): RaceRoomModelSpec | null {
  return getRaceRoomModelForCourse(courseId);
}

/**
 * Run the full prediction pipeline with an already-loaded model. Exposed so
 * tests (and any caller with the model in hand) can skip the network fetch.
 */
export function runRoomPrediction(
  raceHorseInfo: Array<Record<string, unknown>>,
  courseId: number,
  model: FrontendModel,
  modelSpec: RaceRoomModelSpec
): RaceRoomPredictionResult | null {
  const rawRoom = buildFrontendRoom(raceHorseInfo, courseId, modelSpec);
  if (!rawRoom) {
    return null;
  }

  const adjustedRoom = applyPreRaceAdjustments(rawRoom, model);
  const encoded = encodeRoom(adjustedRoom, model);
  const normalized = encoded.features.map((team) =>
    team.map((horse) =>
      applyNormalization(horse, model.normalization.mean, model.normalization.std)
    )
  );

  return {
    modelId: modelSpec.id,
    predictions: predictEncodedRoom(normalized, encoded.orderedHorses, model)
  };
}

async function predictFromHorseInfo(
  raceHorseInfo: Array<Record<string, unknown>>,
  courseId: number | undefined
): Promise<RaceRoomPredictionResult | null> {
  const modelSpec = getRaceRoomModelForCourse(courseId);
  if (!modelSpec || courseId === undefined) {
    return null;
  }

  const model = await loadRaceRoomModel(modelSpec);
  return runRoomPrediction(raceHorseInfo, courseId, model, modelSpec);
}

/** Predict win favorites for a raw raceHorseInfo room (e.g. an imported file). */
function predictRaceRoom(
  raceHorseInfo: Array<Record<string, unknown>>,
  courseId: number | undefined
): Promise<RaceRoomPredictionResult | null> {
  return predictFromHorseInfo(raceHorseInfo, courseId);
}

/** Predict win favorites for the current race-sim field. */
export function predictRaceRoomForRunners(
  runners: IRunnerState[],
  courseId: number | undefined
): Promise<RaceRoomPredictionResult | null> {
  return predictFromHorseInfo(runnersToRaceHorseInfo(runners), courseId);
}
