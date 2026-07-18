# ADR-0005: Two Simulation Engines over Shared Pure Primitives

## Status

Accepted. The temporary TS-oracle/parity-gate portions are superseded by [ADR-0006](0006-retire-ts-simulation-oracle.md).

Supersedes an earlier draft of this ADR that proposed a single engine with a
`FieldModel` runtime seam — see "Discarded options". Builds on the parity bar
set by [ADR-0004](0004-wasm-ts-statistical-parity.md).

## Context

The simulation core served two fundamentally different paradigms over one
physics model:

- **Full Race Sim** — the contested bench. Nine real runners; contention
  (dueling, spot-struggle, position-keep, blocking) and skill/terrain
  interactions *emerge* from actual field proximity. Produces statistics over
  many randomized rounds to rank which builds win a real race.
- **Solo / Compare Sim** — the vacuum bench. Typically one runner; the absent
  field is ignored or *synthesized* (artificial `DuelingRates`) and
  field-dependent skill conditions are *approximated*. Produces the bashin-delta
  between builds under controlled, low-variance conditions.

Both ran through **one engine** gated by a `SimulationMode { Normal, Compare }`
flag threaded through `PrepareContext` / `UpdateContext` /
`ConditionFilterParams`. Every non-test `mode` read was a *field-presence*
decision, but it lived **inside formula code**:

- `racing/race.rs` — prepare-time field-composition folding + the dueling /
  spot-struggle coordinator passes.
- `racing/runner/physics.rs` — side-block / overtake telemetry (live field only).
- `racing/runner/mechanics.rs` — artificial-rate dueling vs proximity dueling.
- `racing/position_keep.rs` — a Compare-only position-keep window multiplier.
- `skills/condition/catalog.rs` — `DynamicOrStatic::resolve` selecting a **live
  dynamic predicate** (Normal) vs a **static approximate region** (Compare).

The root entanglement: the `Runner` did two jobs in one place — it **computed
formulas** *and* **decided what the field was doing**. Field-presence only ever
touched the second job, so the formula code was forced to ask "which mode am I?"
mid-decision. A per-runner tick is in fact **~90% pure formula** (timers, phase,
target speed, forces, hills, start dash, HP drain, finish detection) plus **~4
field-touch points** (skill-activation-vs-field, position-keep-vs-pacer, lane
side-block/overtake, dueling).

## Decision

**Split into two purpose-built engines over a shared package of pure
primitives.** Every engine is straight-line, single-purpose, and contains **no
`if mode` anywhere**. The shared *step kernel* and the field-agnostic
race-orchestration *support* live once in the primitives package; only the
paradigm-specific **production** of field inputs (and, for the contested engine,
the contention coordinator) differs.

### Packages

- **`uma-sim-primitives`** — pure, zero field-awareness. The single source of
  game fidelity:
  - the formulas (target speed, forces, hills, start dash, HP/stamina, phase);
  - the shared `Runner` **state** + the pure **step kernel**
    `Runner::on_update(dt, &FieldInputs, &UpdateContext)`;
  - the condition **parser** + catalog + region math; RNG (`xoshiro256**`);
    course math; the data models (`Skill`, `CourseData`, `StatLine`, …);
  - the read-model **projection primitives** (`count_effects` /
    `reconcile_effects` / `close_all` / `SkillEffectLog`);
  - **field-agnostic race support** (`race_support`, `events`, `pacing`, `mob`,
    and the `RunnerObservation for Runner` impl): the per-frame field snapshot,
    the per-runner field view, pacer selection + finishing-order tracking, the
    observer port, and the producer leaf-helpers (`has_side_blocking_runner` /
    `is_overtaking_runner` for the live field, `condition_value` for the
    approximate field). These are pure mechanics over runner positions — they
    never branch on paradigm — so keeping them in one place stops the two
    engines from drifting.
- **`uma-sim-race`** — the contested engine. Builds the field snapshot, runs the
  contention (proximity dueling / spot-struggle) coordinator passes, resolves
  conditions live (`ConditionResolution::Dynamic`, ×10 position-keep window —
  mechanics § Position Keeping sections 1–10), **produces `FieldInputs` from the
  real field**, calls the shared step, and drives the 9-field + distribution
  orchestration (`run_race_sim`) plus the streaming `WasmRaceSimulator`.
  Read-models: `RaceSimDataCollector`, `RaceEventLogCollector`.
- **`uma-sim-vacuum`** — the solo engine. Single-/small-field loop with **no
  contention coordinator and no field-composition folding**, synthetic dueling
  from `DuelingRates`, approximate conditions
  (`ConditionResolution::Static`, ×10 position-keep window), **produces
  `FieldInputs` from approximate condition values + synthetic rates**, calls the
  same shared step, and drives the paired-delta orchestration (`run_compare`).
  Read-model: `CompareDataCollector`.

> **Amendment (pacing fidelity):** Contested originally shipped with a ×3
> position-keep window inherited from the retired TS reference. Both engines now
> use ×10 so the contested bench matches canon sections 1–10.

### The seam is **data, not a switch**: `FieldInputs`

`FieldInputs` is a plain struct of **already-resolved values**. Each engine
*produces* it; the step kernel and every formula merely *consume* it and never
branch on paradigm.

| `FieldInputs` field | `uma-sim-race` produces from… | `uma-sim-vacuum` produces from… |
|---|---|---|
| `side_blocked`, `overtaking` | live field snapshot | approximate `condition_value` (else `false`) |
| `position_keep` target / pacer gap | the real pacer | the lone-runner trivial case |
| `dueling` | `Coordinated` (proximity coordinator) | `Artificial(Option<DuelingRates>)` |
| resolved skill triggers | live dynamic predicates vs the field | approximate static regions |

The branch does not move — it **evaporates**: the vacuum engine simply never
produces `side_blocked = true` from a live field; the race engine computes it
from the snapshot. Neither the step nor any formula carries a paradigm flag.

### A shared step kernel, not just leaf formulas

`uma-sim-primitives` owns the `Runner` state *and* the pure
`Runner::on_update(...)` step; both engines call it. (Rejected alternative:
share only small leaf formulas and let each engine write its own `Runner` — see
"Discarded options".) Rationale: the formulas are genuinely identical across
paradigms and must stay faithful to a **reverse-engineered** target; keeping
them in exactly one place makes physics drift between the two engines
impossible.

## Consequences

- Each engine is short, readable, single-purpose; the paradigm is legible from
  the package you are in, not from grepping `mode`.
- Game formulas — and the field-agnostic snapshot/observation/pacing mechanics —
  live once → both engines stay faithful to the reverse-engineered target and
  cannot drift.
- `SimulationMode` is **deleted**; the `apply_mode` / `DynamicOrStatic` mode
  branch is gone — condition-resolution strategy (`ConditionResolution`) and the
  position-keep window multiplier are explicit engine inputs at the boundary,
  not runtime flags inside the catalog/step.
- Illegal states unrepresentable: no vacuum run with live contention; no
  contested run carrying stray dueling rates (rates live only in
  `uma-sim-vacuum`).
- **Realized cost:** the per-engine loop *skeleton* (the ~60-line `on_update`
  orchestration + `prepare_round`) is written twice, but the heavy field-agnostic
  mechanics it calls are shared via `race_support`, so duplication is small and
  the contention coordinator exists only where it is meaningful (race).
- **WASM:** `uma-sim-wasm` depends on both engines. `runRaceSim` /
  `WasmRaceSimulator` drive `uma-sim-race`; `runCompare` drives `uma-sim-vacuum`.
  The DTO layer builds each engine's own `SimulationSettings` (no `mode` field) —
  the engine is selected by the entry point, not a runtime flag. The streaming
  observer machinery (`observer.rs`) is race-only.
- **`impl RunnerObservation for Runner`** is a local-trait-for-local-type impl in
  primitives (both trait and `Runner` live there); it is pure state-reads and is
  shared, not duplicated.

## Migration sequence (behavior-preserving, each step parity-gated)

The implemented sequence (each commit green + parity GO):

1. **Introduce `FieldInputs`.** Routed the field-touch points in
   `Runner::on_update` through a resolved `FieldInputs` struct instead of
   `ctx.mode` / `ctx.field`. (t-001, t-002)
2. **Extract the leaf primitives.** `shared_kernel` + `course`, then the `skills`
   module + projection primitives, into `uma-sim-primitives`; de-branched
   `DynamicOrStatic` into an explicit `ConditionResolution` engine input.
   (t-003, t-004)
3. **Producer lift.** Moved `resolve_field_inputs` + the producer leaf-helpers
   out of `impl Runner` into the `Race` aggregate, leaving the per-runner step
   field-presence-free and relocatable. (t-004b)
4. **Relocate the step kernel.** Moved the `Runner` entity + step
   (`physics`/`mechanics`/`skills`/`lifecycle`) + `stamina` + `position_keep`
   into `uma-sim-primitives`; de-moded the last prepare-time reads
   (`condition_resolution` + `pos_keep_end_multiplier` became engine-supplied
   `PrepareContext` fields). Moved the field-agnostic race support
   (`events`/`pacing`/`mob`/`RunnerObservation`/`race_support`) too. (t-004c)
5. **Build `uma-sim-race`** — contested producer + coordinator + distribution.
   (t-005)
6. **Build `uma-sim-vacuum`** — synthetic/approximate producer + paired-delta.
   (t-006)
7. **Delete the combined engine + `SimulationMode`** and **rewire the WASM
   wrappers** to the two engines. (t-007, t-008)

## Parity / safety gate (every step)

`cargo test` across the workspace · `cargo clippy --workspace --all-targets --
-D warnings` · `cargo fmt --check` · `pnpm run typecheck` · `pnpm run lint` · `pnpm
run wasm:build`. The ADR-0004 statistical-parity + per-skill suites
(`parity.test.ts`, node-target WASM) must remain **GO**.

### Parity re-validation (split landed)

Re-validated against the TS reference after the engine split, on a node-target
WASM build (`wasm-pack build --target nodejs`):

- `parity.test.ts -t planner` (compare / vacuum path) — **GO**.
- `parity.test.ts -t 9-runner` (contested / race path) — **GO**.

The split is therefore **bit-identical** to the previous combined engine; the
shared `race_support` extraction and the two producers reproduce the reference
output exactly. Workspace tests green (`uma-sim-primitives`, `uma-sim-race`,
`uma-sim-vacuum`), clippy `-D warnings`, fmt, typecheck, lint, and `wasm:build`
all pass.

## Resolved

- **Package names.** `uma-sim-primitives` (pure), plus `uma-sim-race` and
  `uma-sim-vacuum`; the old `uma-sim-core` is deleted.
- **Shared mechanics vs duplication.** Rather than duplicate the field-agnostic
  snapshot/observation/pacing machinery into both engines (the draft's "accepted
  cost"), it was extracted once into `uma-sim-primitives::race_support` and
  friends. Only the straight-line loop skeleton + paradigm-specific producer
  (and the race-only coordinator) live in each engine. This keeps the
  "no `if mode`, single-purpose" property while eliminating drift risk.
- **Streaming simulator.** `WasmRaceSimulator` (per-tick observer callbacks) is
  **race-only**. The vacuum engine runs **headless batched updates** — it has no
  per-tick callback surface; it executes N rounds and returns the aggregated
  read-model in bulk (paired-delta orchestration). The wasm observer machinery
  belongs to `uma-sim-race` exclusively.
- **`FieldInputs` granularity.** The scalar touch points (`side_blocked`,
  `overtaking`, `dueling`, position-keep) stay **flat**; the resolved skill
  triggers are their **own structured type** (`SkillTriggerInputs`, borrowing the
  field view so the per-tick step allocates nothing).
- **Reduction (axis B).** Distribution vs paired-delta stays in each engine's
  orchestration + the TS side; not materialized as a shared type (no
  cross-engine consumer).

## Discarded options

- **Single engine with a `FieldModel` runtime seam.** Keep one engine and inject
  a `FieldModel` trait that abstracts "what is the field doing". Rejected: it
  preserves a runtime branch (the seam) inside the engine, so the paradigm is
  still decided mid-tick rather than being legible from the package boundary; it
  does not deliver the "no `if mode` anywhere, straight-line per engine"
  property.
- **Share only leaf formulas; each engine writes its own `Runner`.** Rejected:
  the formulas are a reverse-engineered target that must not drift; duplicating
  the `Runner` state + step across two engines invites exactly that drift. The
  shared step kernel keeps physics in one place.
