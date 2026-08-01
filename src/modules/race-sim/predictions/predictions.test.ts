import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseHakurakuRaceJson } from '@/modules/race-sim/share/hakuraku';
import { createRunnerState } from '@/modules/runners/components/runner-card/domain/runner-state';
import type { IRunnerState } from '@/modules/runners/components/runner-card/domain/runner-state';
import { getRaceRoomModelForCourse } from './registry';
import { runRoomPrediction, runnersToRaceHorseInfo } from './index';
import type { FrontendModel } from './types';

const MODEL_PATH = resolve(
  __dirname,
  '../../../../public/data/race-prediction/cm14-room-model.json.gz'
);

function loadModel(): FrontendModel {
  const gz = readFileSync(MODEL_PATH);
  return JSON.parse(gunzipSync(gz).toString('utf8')) as FrontendModel;
}

// A synthetic 3v3v3 CM field (course 10602) with distinct gates/teams.
function makeField(): IRunnerState[] {
  const outfits = [
    '100101',
    '100201',
    '100301',
    '100401',
    '100501',
    '100801',
    '101001',
    '101101',
    '101401'
  ];
  return outfits.map((outfitId, index) =>
    createRunnerState({
      outfitId,
      strategy: index % 2 === 0 ? 'Front Runner' : 'Pace Chaser',
      team: Math.floor(index / 3) + 1,
      gate: index + 1,
      speed: 1100 + index * 10,
      stamina: 900,
      power: 800,
      guts: 600,
      wisdom: 700
    })
  );
}

describe('race-sim room-winner prediction', () => {
  const model = loadModel();
  const modelSpec = getRaceRoomModelForCourse(10602)!;

  it('produces 9 calibrated predictions for a 3v3v3 field', () => {
    const horseInfo = runnersToRaceHorseInfo(makeField());
    const result = runRoomPrediction(horseInfo, 10602, model, modelSpec);

    expect(result).not.toBeNull();
    const predictions = result!.predictions;
    expect(predictions).toHaveLength(9);

    const total = predictions.reduce((sum, p) => sum + p.probability, 0);
    expect(total).toBeCloseTo(1, 5);

    for (const p of predictions) {
      expect(p.probability).toBeGreaterThanOrEqual(0);
      expect(p.probability).toBeLessThanOrEqual(1);
    }

    const ranks = predictions.map((p) => p.rank).sort((a, b) => a - b);
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('returns null for a non-3v3v3 field shape', () => {
    const horseInfo = runnersToRaceHorseInfo(makeField().slice(0, 6));
    expect(runRoomPrediction(horseInfo, 10602, model, modelSpec)).toBeNull();
  });

  it('parses + predicts from a real Hakuraku CM file when present', () => {
    let raw: string;
    try {
      raw = readFileSync(resolve(__dirname, '__fixtures__/cm14-room.json'), 'utf8');
    } catch {
      return; // fixture optional; skip when not bundled
    }
    const snapshot = parseHakurakuRaceJson(raw);
    expect(snapshot).not.toBeNull();
    const result = runRoomPrediction(
      runnersToRaceHorseInfo(snapshot!.runners),
      10602,
      model,
      modelSpec
    );
    expect(result?.predictions).toHaveLength(9);
  });
});
