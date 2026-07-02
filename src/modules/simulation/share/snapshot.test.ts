import { describe, expect, it } from 'vitest';
import { createRunnerState } from '@/modules/runners/components/runner-card/types';
import { createRaceConditions } from '@/utils/races';
import { parseSnapshotJson } from './snapshot';
import { SIMULATION_SNAPSHOT_VERSION } from './types';
import type { SimulationSnapshot } from './types';

const witVarianceSettings = {
  allowRushedUma1: true,
  allowRushedUma2: true,
  allowDownhillUma1: true,
  allowDownhillUma2: true,
  allowConservePowerUma1: true,
  allowConservePowerUma2: true,
  allowSectionModifierUma1: true,
  allowSectionModifierUma2: true,
  allowSkillCheckChanceUma1: true,
  allowSkillCheckChanceUma2: true,
  simWitVariance: true
};

function snapshot(overrides: Partial<SimulationSnapshot> = {}): SimulationSnapshot {
  return {
    version: SIMULATION_SNAPSHOT_VERSION,
    timestamp: 123,
    runners: [createRunnerState(), createRunnerState()],
    compareA: 0,
    compareB: 1,
    courseId: 10101,
    racedef: createRaceConditions(),
    seed: 42,
    nsamples: 10,
    compareMode: 'contested',
    fillWithMobs: true,
    witVarianceSettings,
    staminaDrainOverrides: {},
    forcedPositions: { uma1: {}, uma2: {} },
    injectedDebuffs: { uma1: [], uma2: [] },
    scenarioOverrides: undefined,
    ...overrides
  };
}

// Common fields shared by every legacy fixture shape.
const legacyCommon = {
  timestamp: 123,
  courseId: 10101,
  racedef: createRaceConditions(),
  seed: 42,
  nsamples: 10,
  witVarianceSettings,
  staminaDrainOverrides: {},
  forcedPositions: { uma1: {}, uma2: {} },
  injectedDebuffs: { uma1: [], uma2: [] }
};

describe('parseSnapshotJson', () => {
  it('round-trips a v2 snapshot (field + compare pair + fillWithMobs)', () => {
    const parsed = parseSnapshotJson(
      JSON.stringify(
        snapshot({
          runners: [createRunnerState(), createRunnerState(), createRunnerState()],
          compareA: 0,
          compareB: 2,
          compareMode: 'contested',
          fillWithMobs: false
        })
      )
    );

    expect(parsed?.version).toBe(SIMULATION_SNAPSHOT_VERSION);
    expect(parsed?.runners).toHaveLength(3);
    expect(parsed?.compareA).toBe(0);
    expect(parsed?.compareB).toBe(2);
    expect(parsed?.compareMode).toBe('contested');
    expect(parsed?.fillWithMobs).toBe(false);
  });

  it('rejects v2 snapshots with out-of-range compare indices', () => {
    expect(
      parseSnapshotJson(JSON.stringify(snapshot({ compareA: 0, compareB: 5 })))
    ).toBeNull();
    expect(
      parseSnapshotJson(JSON.stringify(snapshot({ compareA: 1, compareB: 1 })))
    ).toBeNull();
  });

  it('rejects unknown / future snapshot versions', () => {
    const future = { ...snapshot(), version: 999 };
    expect(parseSnapshotJson(JSON.stringify(future))).toBeNull();
  });

  it('imports a v1 legacy snapshot, mapping fieldComposition → fillWithMobs', () => {
    const v1Mobs = {
      version: 1,
      ...legacyCommon,
      uma1: createRunnerState(),
      uma2: createRunnerState(),
      compareMode: 'contested',
      fieldComposition: 'mobs'
    };
    const parsedMobs = parseSnapshotJson(JSON.stringify(v1Mobs));
    expect(parsedMobs?.runners).toHaveLength(2);
    expect(parsedMobs?.compareA).toBe(0);
    expect(parsedMobs?.compareB).toBe(1);
    expect(parsedMobs?.compareMode).toBe('contested');
    expect(parsedMobs?.fillWithMobs).toBe(true);

    const v1Duo = { ...v1Mobs, fieldComposition: 'duo' };
    const parsedDuo = parseSnapshotJson(JSON.stringify(v1Duo));
    expect(parsedDuo?.fillWithMobs).toBe(false);
  });

  it('imports a pre-versioned legacy snapshot in vacuum mode', () => {
    const legacy = {
      ...legacyCommon,
      uma1: createRunnerState(),
      uma2: createRunnerState()
    };

    const parsed = parseSnapshotJson(JSON.stringify(legacy));

    expect(parsed?.version).toBe(SIMULATION_SNAPSHOT_VERSION);
    expect(parsed?.runners).toHaveLength(2);
    expect(parsed?.compareMode).toBe('vacuum');
    expect(parsed?.fillWithMobs).toBe(true);
  });
});
