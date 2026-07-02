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
    uma1: createRunnerState(),
    uma2: createRunnerState(),
    courseId: 10101,
    racedef: createRaceConditions(),
    seed: 42,
    nsamples: 10,
    compareMode: 'contested',
    fieldComposition: 'duo',
    witVarianceSettings,
    staminaDrainOverrides: {},
    forcedPositions: { uma1: {}, uma2: {} },
    injectedDebuffs: { uma1: [], uma2: [] },
    scenarioOverrides: undefined,
    ...overrides
  };
}

describe('parseSnapshotJson', () => {
  it('preserves compare mode and field composition for new snapshots', () => {
    const parsed = parseSnapshotJson(
      JSON.stringify(snapshot({ compareMode: 'contested', fieldComposition: 'mobs' }))
    );

    expect(parsed?.compareMode).toBe('contested');
    expect(parsed?.fieldComposition).toBe('mobs');
  });

  it('opens old snapshots without compare settings in vacuum mode', () => {
    const oldSnapshot = snapshot() as Partial<SimulationSnapshot>;
    delete oldSnapshot.compareMode;
    delete oldSnapshot.fieldComposition;

    const parsed = parseSnapshotJson(JSON.stringify(oldSnapshot));

    expect(parsed?.compareMode).toBe('vacuum');
    expect(parsed?.fieldComposition).toBe('duo');
  });
});
