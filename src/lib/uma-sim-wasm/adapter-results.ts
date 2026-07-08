// Result-side conversions: WASM boundary output DTOs -> uma-domain
// shapes the UI consumes. This half is data-free (pure reshaping) and therefore
// worker-safe: it MUST NOT import anything under `src/modules/data/**`. Keeping
// it separate from `adapter-params.ts` is what lets worker bundles stay free of
// the inlined datasets.

import type { RaceSimResult, FinishEntry } from '@/lib/uma-domain/race/run-race-sim';
import type { RaceEvent, RaceEventKind } from '@/lib/uma-domain/race/race-event-log';
import type { IStrategy } from '@/lib/uma-domain/runner/definitions';
import type { CollectedRunnerRoundData } from '@/lib/uma-domain/race/race-observer';
import type { ISkillPerspective, ISkillTarget, ISkillType } from '@/lib/uma-domain/skills/definitions';
import type { SkillEffectLog } from '@/modules/simulation/compare.types';
import type { WasmCompareRoundData, WasmRaceSimResult, WasmSkillEffectLog } from './types';

/** Map a WASM skill-activation map to the TS `SkillEffectLog` map. */
function skillActivationMapFromWasm(
  map: Record<string, WasmSkillEffectLog[]>
): Record<string, SkillEffectLog[]> {
  const out: Record<string, SkillEffectLog[]> = {};
  for (const [skillId, logs] of Object.entries(map)) {
    out[skillId] = logs.map((log) => ({
      executionId: log.executionId,
      skillId: log.skillId,
      start: log.start,
      end: log.end,
      perspective: log.perspective as ISkillPerspective,
      effectType: log.effectType as ISkillType,
      effectTarget: log.effectTarget as ISkillTarget
    }));
  }
  return out;
}

/**
 * Reshape one WASM `CompareRoundData` into the uma-domain
 * `CollectedRunnerRoundData` the compare orchestration consumes. Optional WASM
 * regions/values map to the `[]`/`null` sentinels the TS shape expects.
 */
export function wasmCompareRoundDataToCollected(
  data: WasmCompareRoundData
): CollectedRunnerRoundData {
  return {
    runnerId: data.runnerId,
    time: data.time,
    position: data.position,
    velocity: data.velocity,
    hp: data.hp,
    currentLane: data.currentLane,
    pacerGap: data.pacerGap,
    order: data.order,
    skillActivations: skillActivationMapFromWasm(data.skillActivations),
    targetedSkillActivations: skillActivationMapFromWasm(data.targetedSkillActivations),
    startDelay: data.startDelay,
    rushed: data.rushed.map(([start, end]) => [start, end] as [number, number]),
    duelingRegion: data.duelingRegion ? [data.duelingRegion[0], data.duelingRegion[1]] : [],
    spotStruggleRegion: data.spotStruggleRegion
      ? [data.spotStruggleRegion[0], data.spotStruggleRegion[1]]
      : [],
    fullyChargedRegion: data.fullyChargedRegion
      ? [data.fullyChargedRegion[0], data.fullyChargedRegion[1]]
      : [],
    fullyChargedAccel: data.fullyChargedAccel ?? null,
    hasAchievedFullSpurt: data.hasAchievedFullSpurt,
    outOfHp: data.outOfHp,
    outOfHpPosition: data.outOfHpPosition ?? null,
    nonFullSpurtVelocityDiff: data.nonFullSpurtVelocityDiff ?? null,
    nonFullSpurtDelayDistance: data.nonFullSpurtDelayDistance ?? null,
    firstPositionInLateRace: data.firstPositionInLateRace,
    usedSkills: data.usedSkills,
    finished: data.finished,
    finishPosition: data.finishPosition
  };
}

/**
 * Reshape the lean WASM result into the rich uma-domain `RaceSimResult` the UI
 * consumes.
 *
 * - `finishOrders` maps numeric strategy 1:1 to `IStrategy`.
 * - `collectedData.rounds[i]` is reconstructed from the all-runner focus traces:
 *   `allRunnerPositions` / `allRunnerLanes` come from each runner's per-tick
 *   samples, `finishOrder` from `finishOrders[i]`, `seed` from the round.
 * - `eventLogs` is projected by the Rust `RaceEventLogCollector` and mapped 1:1
 *   here (the WASM `kind` is a kebab-case string matching `RaceEventKind`).
 * - per-focus-runner `skillActivations` are projected by the Rust collector as
 *   real `[start, end]` effect-duration logs (mirroring the compare collector),
 *   so the Focus Runner Detail overlay renders duration bars (t-010). They are
 *   read here as a `Record` (the WASM `HashMap` serializes as a JS object via
 *   `serialize_maps_as_objects(true)` in `to_js`), not a `Map`.
 */
export function wasmResultToRaceSimResult(result: WasmRaceSimResult): RaceSimResult {
  const finishOrders: FinishEntry[][] = result.finishOrders.map((round) =>
    round.map((entry) => ({
      runnerId: entry.runnerId,
      name: entry.name,
      strategy: entry.strategy as IStrategy,
      finishPosition: entry.finishPosition,
      finishTime: entry.finishTime
    }))
  );

  const rounds = result.collected.map((round, roundIndex) => {
    const allRunnerPositions: Record<number, number[]> = {};
    const allRunnerLanes: Record<number, number[]> = {};
    const focusRunnerData: RaceSimResult['collectedData']['rounds'][number]['focusRunnerData'] = {};
    for (const trace of round.focus) {
      const positions = trace.samples.map((s) => s.position);
      const lanes = trace.samples.map((s) => s.lane);
      allRunnerPositions[trace.runnerId] = positions;
      allRunnerLanes[trace.runnerId] = lanes;
      // Reconstruct the per-runner detail series the UI charts. `skillActivations`
      // are real `[start, end]` effect-duration logs projected by the Rust
      // collector (t-010). Fields the WASM telemetry does not capture and the
      // Race Sim UI does not consume (pacer gap, targeted activations, mechanic
      // regions) keep neutral defaults; the mechanic timelines are rendered from
      // the event log instead.
      focusRunnerData[trace.runnerId] = {
        runnerId: trace.runnerId,
        time: trace.samples.map((s) => s.time),
        position: positions,
        velocity: trace.samples.map((s) => s.speed),
        hp: trace.samples.map((s) => s.health),
        currentLane: lanes,
        pacerGap: trace.samples.map(() => 0),
        order: trace.samples.map(() => 0),
        skillActivations: skillActivationMapFromWasm(trace.skillActivations),
        targetedSkillActivations: {},
        startDelay: 0,
        rushed: [],
        duelingRegion: [],
        spotStruggleRegion: [],
        fullyChargedRegion: [],
        fullyChargedAccel: null,
        hasAchievedFullSpurt: false,
        outOfHp: false,
        outOfHpPosition: null,
        nonFullSpurtVelocityDiff: null,
        nonFullSpurtDelayDistance: null,
        firstPositionInLateRace: false,
        usedSkills: [],
        finished: true,
        finishPosition: positions.length > 0 ? positions[positions.length - 1] : 0
      };
    }
    return {
      seed: round.seed,
      finishOrder: finishOrders[roundIndex] ?? [],
      focusRunnerData,
      allRunnerPositions,
      allRunnerLanes
    };
  });

  const eventLogs: RaceEvent[][] = result.eventLogs.map((round) =>
    round.map((event) => ({
      kind: event.kind as RaceEventKind,
      runnerId: event.runnerId,
      position: event.position,
      tick: event.tick,
      detail: event.detail
        ? {
            skillId: event.detail.skillId,
            otherRunnerIds: event.detail.otherRunnerIds,
            finishPlace: event.detail.finishPlace,
            finishTime: event.detail.finishTime
          }
        : undefined
    }))
  );

  return {
    finishOrders,
    collectedData: { rounds },
    eventLogs
  };
}
