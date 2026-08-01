import { describe, it, expect, beforeEach } from 'vitest';
import { Mood } from '@/lib/uma-domain/runner/definitions';
import { createRunnerState } from '@/modules/runners/components/runner-card/domain/runner-state';
import { createRaceConditions } from '@/utils/races';
import { useSettingsStore } from '@/store/settings.store';
import { useRaceSimStore } from '@/modules/simulation/stores/race-sim.store';
import { buildRaceSimSnapshot, parseRaceSimSnapshotJson, importRaceSimSnapshot } from './snapshot';
import { RACE_SIM_SNAPSHOT_VERSION } from './types';

const makeRunners = () => [
  createRunnerState({
    outfitId: '100101',
    strategy: 'Front Runner',
    mood: Mood.Great,
    team: 1,
    gate: 3,
    rankScore: 17527,
    star: 5,
    skillLevels: { '100271': 6 },
    aptitudes: {
      distanceShort: 'A',
      distanceMile: 'A',
      distanceMiddle: 'S',
      distanceLong: 'B',
      turf: 'A',
      dirt: 'G',
      nige: 'A',
      senko: 'A',
      sashi: 'B',
      oikomi: 'C'
    }
  }),
  createRunnerState({ outfitId: '100201', strategy: 'Pace Chaser', team: 2, gate: 7 })
];

describe('race-sim snapshot', () => {
  beforeEach(() => {
    useRaceSimStore.setState({
      runners: makeRunners(),
      nsamples: 5,
      seed: 12345,
      focusRunnerIndices: [0],
      results: null,
      isStale: false
    });
    useSettingsStore.setState({
      courseId: 10101,
      racedef: createRaceConditions({ ground: 1 })
    });
  });

  it('round-trips through JSON', () => {
    const snapshot = buildRaceSimSnapshot();
    const json = JSON.stringify(snapshot);
    const parsed = parseRaceSimSnapshotJson(json);

    expect(parsed).not.toBeNull();
    expect(parsed).toEqual(snapshot);
    expect(parsed?.version).toBe(RACE_SIM_SNAPSHOT_VERSION);
    // Team grouping and gate posts survive the round-trip.
    expect(parsed?.runners.map((runner) => runner.team)).toEqual([1, 2]);
    expect(parsed?.runners.map((runner) => runner.gate)).toEqual([3, 7]);
    expect(parsed?.runners[0].rankScore).toBe(17527);
    expect(parsed?.runners[0].star).toBe(5);
    expect(parsed?.runners[0].skillLevels).toEqual({ '100271': 6 });
    expect(parsed?.runners[0].aptitudes?.distanceMiddle).toBe('S');
  });

  it('importRaceSimSnapshot writes both stores and resets results/isStale', () => {
    useRaceSimStore.setState({ results: {} as never, isStale: true });

    const snapshot = buildRaceSimSnapshot();
    snapshot.courseId = 20202;
    snapshot.nsamples = 8;
    snapshot.seed = null;
    snapshot.focusRunnerIndices = [1];

    importRaceSimSnapshot(snapshot);

    const raceSim = useRaceSimStore.getState();
    const settings = useSettingsStore.getState();

    expect(settings.courseId).toBe(20202);
    expect(raceSim.nsamples).toBe(8);
    expect(raceSim.seed).toBeNull();
    expect(raceSim.focusRunnerIndices).toEqual([1]);
    expect(raceSim.runners).toHaveLength(2);
    expect(raceSim.results).toBeNull();
    expect(raceSim.isStale).toBe(false);
  });

  it('rejects invalid input', () => {
    expect(parseRaceSimSnapshotJson('not json')).toBeNull();
    expect(parseRaceSimSnapshotJson('')).toBeNull();

    const base = buildRaceSimSnapshot();

    expect(parseRaceSimSnapshotJson(JSON.stringify({ ...base, version: 999 }))).toBeNull();
    expect(parseRaceSimSnapshotJson(JSON.stringify({ ...base, runners: undefined }))).toBeNull();
    expect(parseRaceSimSnapshotJson(JSON.stringify({ ...base, runners: 'nope' }))).toBeNull();
    expect(parseRaceSimSnapshotJson(JSON.stringify({ ...base, runners: [] }))).toBeNull();

    const badRunner = structuredClone(base) as Record<string, any>;
    delete badRunner.runners[0].outfitId;
    expect(parseRaceSimSnapshotJson(JSON.stringify(badRunner))).toBeNull();

    expect(parseRaceSimSnapshotJson(JSON.stringify({ ...base, racedef: { foo: 1 } }))).toBeNull();
    expect(parseRaceSimSnapshotJson(JSON.stringify({ ...base, seed: 'abc' }))).toBeNull();
  });
});
