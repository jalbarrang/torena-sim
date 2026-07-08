import { describe, expect, it } from 'vitest';
import { wasmCompareRoundDataToCollected, wasmResultToRaceSimResult } from './adapter-results';
import type { WasmCompareRoundData, WasmRaceSimResult } from './types';

function baseRound(overrides: Partial<WasmCompareRoundData> = {}): WasmCompareRoundData {
  return {
    runnerId: 0,
    time: [0, 0.066],
    position: [10, 20],
    velocity: [18, 18.5],
    hp: [900, 880],
    currentLane: [0, 0],
    pacerGap: [0, 0],
    order: [0, 0],
    skillActivations: {},
    targetedSkillActivations: {},
    startDelay: 0.1,
    rushed: [],
    hasAchievedFullSpurt: false,
    outOfHp: false,
    firstPositionInLateRace: false,
    usedSkills: [],
    finished: true,
    finishPosition: 2400,
    ...overrides
  };
}

describe('wasmCompareRoundDataToCollected', () => {
  it('maps optional regions/values to the TS []/null sentinels', () => {
    const collected = wasmCompareRoundDataToCollected(baseRound());

    // Absent optional regions become empty-array sentinels.
    expect(collected.duelingRegion).toEqual([]);
    expect(collected.spotStruggleRegion).toEqual([]);
    // Absent optional numbers become null.
    expect(collected.outOfHpPosition).toBeNull();
    expect(collected.nonFullSpurtVelocityDiff).toBeNull();
    expect(collected.nonFullSpurtDelayDistance).toBeNull();
  });

  it('preserves present regions and numeric fields', () => {
    const collected = wasmCompareRoundDataToCollected(
      baseRound({
        rushed: [[300, 360]],
        duelingRegion: [1000, 1200],
        spotStruggleRegion: [1500, 1600],
        outOfHp: true,
        outOfHpPosition: 2100,
        nonFullSpurtVelocityDiff: 0.5,
        nonFullSpurtDelayDistance: 12
      })
    );

    expect(collected.rushed).toEqual([[300, 360]]);
    expect(collected.duelingRegion).toEqual([1000, 1200]);
    expect(collected.spotStruggleRegion).toEqual([1500, 1600]);
    expect(collected.outOfHp).toBe(true);
    expect(collected.outOfHpPosition).toBe(2100);
    expect(collected.nonFullSpurtVelocityDiff).toBe(0.5);
    expect(collected.nonFullSpurtDelayDistance).toBe(12);
  });

  it('maps numeric perspective/type/target into skill-activation logs', () => {
    const collected = wasmCompareRoundDataToCollected(
      baseRound({
        skillActivations: {
          '100001': [
            {
              executionId: '7-0-0',
              skillId: '100001',
              start: 100,
              end: 120,
              perspective: 1,
              effectType: 27,
              effectTarget: 0
            }
          ]
        },
        targetedSkillActivations: {
          '200001': [
            {
              executionId: '7-0-1',
              skillId: '200001',
              start: 500,
              end: 500,
              perspective: 2,
              effectType: 9,
              effectTarget: 4
            }
          ]
        }
      })
    );

    const selfLog = collected.skillActivations['100001'][0];
    expect(selfLog.perspective).toBe(1);
    expect(selfLog.effectType).toBe(27);
    expect(selfLog.start).toBe(100);
    expect(selfLog.end).toBe(120);

    const targetedLog = collected.targetedSkillActivations['200001'][0];
    expect(targetedLog.perspective).toBe(2);
    expect(targetedLog.effectType).toBe(9);
    expect(targetedLog.effectTarget).toBe(4);
  });
});

describe('wasmResultToRaceSimResult', () => {
  const result: WasmRaceSimResult = {
    finishOrders: [
      [
        {
          runnerId: 0,
          name: 'Runner 1',
          strategy: 1,
          finishPosition: 2400,
          finishTime: 120.5
        }
      ]
    ],
    collected: [
      {
        seed: 42,
        focus: [
          {
            runnerId: 0,
            samples: [
              { time: 0, position: 0, speed: 18, lane: 0, health: 1000 },
              { time: 0.066, position: 5, speed: 19, lane: 0, health: 990 }
            ],
            skillActivations: {
              '100001': [
                {
                  executionId: '42-0-0',
                  skillId: '100001',
                  start: 400,
                  end: 760,
                  perspective: 1,
                  effectType: 27,
                  effectTarget: 1
                },
                {
                  executionId: '42-0-1',
                  skillId: '100001',
                  start: 800,
                  end: 800,
                  perspective: 1,
                  effectType: 9,
                  effectTarget: 1
                }
              ]
            }
          }
        ]
      }
    ],
    eventLogs: [
      [
        {
          kind: 'skill-activated',
          runnerId: 0,
          position: 400,
          tick: 90,
          detail: { skillId: '100001' }
        },
        {
          kind: 'skill-activated',
          runnerId: 0,
          position: 800,
          tick: 180,
          detail: { skillId: '100001' }
        },
        // No skillId -> skipped for the activation overlay.
        { kind: 'skill-activated', runnerId: 0, position: 850, tick: 190 },
        // Belongs to another runner -> not attributed to runner 0.
        {
          kind: 'skill-activated',
          runnerId: 1,
          position: 500,
          tick: 110,
          detail: { skillId: '200001' }
        },
        { kind: 'rushed', runnerId: 0, position: 100, tick: 20 }
      ]
    ]
  };

  it('maps event logs 1:1 (kind, runnerId, position, tick, detail)', () => {
    const out = wasmResultToRaceSimResult(result);
    expect(out.eventLogs).toHaveLength(1);
    expect(out.eventLogs[0]).toHaveLength(5);
    expect(out.eventLogs[0][0]).toMatchObject({
      kind: 'skill-activated',
      runnerId: 0,
      position: 400,
      tick: 90,
      detail: { skillId: '100001' }
    });
    expect(out.eventLogs[0][4].kind).toBe('rushed');
  });

  it('maps per-focus-runner skill activations from the trace duration logs', () => {
    const out = wasmResultToRaceSimResult(result);
    const focus = out.collectedData.rounds[0].focusRunnerData[0];

    // The collector projects real [start, end] effect logs (read as a Record).
    expect(Object.keys(focus.skillActivations)).toEqual(['100001']);
    const logs = focus.skillActivations['100001'];
    expect(logs).toHaveLength(2);
    expect(logs.map((l) => l.start)).toEqual([400, 800]);
    // The first is a duration effect (end > start); the second a point marker.
    expect(logs[0].end).toBe(760);
    expect(logs[0].end).toBeGreaterThan(logs[0].start);
    expect(logs[1].start).toBe(logs[1].end);
    expect(logs.every((l) => l.skillId === '100001')).toBe(true);
  });

  it('reconstructs focus telemetry series and round seed', () => {
    const out = wasmResultToRaceSimResult(result);
    const round = out.collectedData.rounds[0];
    expect(round.seed).toBe(42);
    expect(round.allRunnerPositions[0]).toEqual([0, 5]);
    expect(round.focusRunnerData[0].velocity).toEqual([18, 19]);
    expect(round.focusRunnerData[0].hp).toEqual([1000, 990]);
  });
});
