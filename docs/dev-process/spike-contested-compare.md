# Spike: Same-race ("contested") compare as default, vacuum as a setting

Status: spike notes — no plan yet. Decision direction confirmed 2026-07-02:
same-race compare becomes the **default**, vacuum compare becomes a **setting**,
field composition **configurable** (two umas only, or two umas + 7 mobs).

## Why

User feedback (Discord): the compare sim shows no spot-struggle at all, and the
Runaway-vs-normal HP drain difference is invisible.

Findings:

- **Engine fidelity already exists.** `stamina/game_policy.rs:59-65` applies the
  spot-struggle HP modifiers (Runaway ×3.5 normal / ×7.7 rushed vs ×1.4 / ×3.6),
  driven by the runner's real `position_keep_strategy` (`physics.rs:258`).
- **The gap is vacuum compare by design** (ADR-0005): no live field, so
  spot-struggle *never emerges*. Dueling is synthesized (`DuelingRates`);
  spot-struggle has no synthetic equivalent — only manual forced-region
  overrides, which users don't discover.
- Other sims run both umas in one race, so these states emerge naturally.
  That is the user expectation we're adopting as default.

## Feasibility findings

### 1. The engines share the observer/collector seam — the key unlock

- Both `Race` aggregates expose identical `subscribe(Box<dyn RaceObserver>)` +
  `add_runner` APIs (`uma-sim-race/race.rs:199,204`; vacuum `197,202`).
- `CompareDataCollector` (`uma-sim-vacuum/collectors.rs`) depends **only on
  primitives** (`events`, `projection`). It can be lifted into
  `uma-sim-primitives` (or a shared module) and attached unchanged to the
  contested engine. That yields compare-grade telemetry — per-tick
  hp/velocity/lane/pacer-gap, rushed/dueling/spot-struggle/fully-charged
  regions, spurt + out-of-HP outcomes — from a real contested race.
- Do **not** extend the race engine's `RaceSimDataCollector`/`FocusTrace`; it
  lacks most compare fields. Reuse `CompareDataCollector` instead, keeping the
  `CompareRoundData` shape (and thus most of the TS reducer) intact.

### 2. Field size

- `run_race_sim` enforces exactly `FIELD_SIZE = 9` (`simulation.rs:98`), but the
  aggregate itself has no such invariant. A new use case
  `run_contested_compare` accepting 2 to 9 runners is straightforward. (Since
  raised to 2 to 12 by the contested-field initiative.)
- "+7 mobs" composition: `uma_sim_primitives::mob::{create_mob_runners,
  generate_mob_field}` already exists.
- 2-only field: `select_pacer` is a pure domain service with full fallback
  chain (works for any field size). `position_keep.rs FORCED_RANK_FIELD_SIZE =
  9.0` only affects forced-rank overrides. Blocking/lane logic tolerates sparse
  fields (it just rarely fires). Needs a smoke test, not a redesign.

### 3. Spot-struggle emerges with just the two compared umas

The group coordinator (`uma-sim-race/race.rs:568`) activates when ≥2
same-strategy bunched runners with front-runner position-keep sit within 3.75 m
/ 0.165 lanes between 150 m and section 5. Two Front Runner / Runaway umas can
trigger it head-to-head (Runaway matches FrontRunner via `strategy_matches`).
With mobs, mob front-runners participate too.

### 4. Orchestration & stats

- Today: `ComparePlan` = two `runCompare` calls sharing a `masterSeed`
  (common-random-numbers variance reduction), reduced by
  `reduceCompareRounds(roundsA, roundsB)` (`wasm-compare.ts`).
- Same-race: **one** run per round; A and B are focus runners in the same race.
  Chunking (`masterSeed + seedOffset`) is unchanged. `roundsA`/`roundsB` are
  extracted per runner-id from each round; the reducer reuses as-is because the
  collector output shape is preserved.
- **Accepted statistical caveat:** in-race interaction correlates A and B
  (they can block/duel *each other*), so the delta measures head-to-head
  performance, not isolated build quality. Vacuum mode remains for isolated
  paired deltas. Surface this distinction in UI copy.

### 5. WASM surface

New entry point `run_contested_compare_wasm` (DTO ≈ compare params + field
composition + contested settings). `run_compare_wasm` / `run_race_sim_wasm`
untouched — no breaking changes. TS side needs a new adapter path in
`adapter-params.ts` and a plan/runner in `wasm-compare.ts`.

### 6. UI

- Compare settings: mode toggle (**Same race** default / Vacuum) + field
  composition (2-only / +7 mobs). Persisted in the simulation settings store.
- Forced-region overrides (`ScenarioOverridesPanel`) are runner-level and
  engine-agnostic (the forced paths live in shared `mechanics.rs`) — keep them
  available in both modes; they're simply less necessary in contested mode.

### 7. Risks / open questions

1. **Variance:** same-race deltas are noisier per round; may need more samples
   for a stable mean bashin. Mitigate by showing a CI; tune default nsamples.
2. **Field-order conditions:** skills conditioned on `order_rate` etc. behave
   differently in a 2-field vs 9-field. "+mobs" may be more game-faithful —
   pick the default composition during planning after trying both.
3. **Gate/lane assignment** for a 2-runner field — verify start lanes are sane.
4. **Position-keep** vs pacer in a 2-runner field — verify pace-down/overtake
   behavior is sensible.
5. **ADR:** write ADR-0007 amending ADR-0005 — contested-compare is a *third
   use case* (contested engine + compare collector), not a reintroduction of
   the `if mode` flag. The engine split survives intact.
6. **Share links / snapshots:** old compare snapshots must deserialize to
   vacuum mode to stay reproducible.

## Rough scope

- Rust: lift collector to primitives (small) · `run_contested_compare` use case
  + WASM entry + DTOs (medium) · tests incl. 2-field smoke + spot-struggle
  emergence (medium).
- TS: adapter + orchestration + reducer wiring (medium) · settings UI +
  persistence + copy (small-medium) · ADR-0007 + docs (small).
- Estimate: 3–5 focused sessions.

## Field-composition decision: default is `mobs` (resolved)

Outcome of the `duo` vs `mobs` experiment (contested-compare-ui t-003). Reproduce
with `bun run wasm:build` then
`bun scripts/run-contested-field-experiment.ts --samples 400 --seed 1`
(`scripts/run-contested-field-experiment.ts`).

400 samples/mode, seed 1, turf, balanced ~1200 spd builds:

| Matchup | Metric | `duo` | `mobs` |
|---------|--------|-------|--------|
| Runaway vs Front Runner (2000m) | spot-struggle A / B | 0% / 0% | 80.5% / 38.5% |
| Runaway vs Front Runner (2000m) | out-of-HP (either) | 0% | 81.0% |
| Runaway vs Front Runner (2000m) | time-δ stdev | 0.072s | 0.873s |
| Pace Chaser mirror (1600m) | dueling A / B | 0% / 0% | 70.5% / 72.5% |
| Pace Chaser mirror (1600m) | time-δ stdev | 0.074s | 0.335s |
| Front Runner mirror (2000m) | spot-struggle A / B | 81.3% / 81.3% | 43.3% / 42.3% |
| Front Runner mirror (2000m) | time-δ stdev | 0.144s | 0.138s |

**Decision: default `mobs`.** The spot-struggle group coordinator
(`uma-sim-race/src/race.rs`) needs ≥2 same-strategy bunched front-runner
position-keep runners; and proximity dueling needs nearby bodies. A 2-runner
field only satisfies this when the two compared umas share a front-running
strategy (the Front Runner mirror row). For asymmetric fields — including the
exact **Runaway vs Front Runner** case from the original user report — `duo`
surfaces **zero** spot-struggle, so the Runaway HP-drain the feature exists to
show never fires. `mobs` surfaces both mechanics across every matchup.

`duo`'s lower time-δ stdev is not "better precision" — it is the variance of a
simulation that isn't modelling the contention. `mobs` trades higher per-round
variance (budget more samples) for faithful emergence and more realistic
order-dependent skill conditions in a full 9-field. `duo` remains available as a
setting for isolated head-to-head reads.

Set in `src/modules/simulation/stores/compare.store.ts`
(`DEFAULT_FIELD_COMPOSITION = 'mobs'`).
