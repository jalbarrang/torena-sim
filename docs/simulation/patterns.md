# Simulation patterns

## Shared runner kernel

The `honse-sim` crate contains shared primitives and two engine modules. Each engine resolves `FieldInputs`, then calls the same runner step kernel. The kernel does not inspect the engine or ask if a live field exists.

Each tick uses a fixed duration of 1/15 second. Each round uses a deterministic seed and resets reusable state before the first tick.

## Contested engine

`honse_sim::contested` models runners in one live field. Use it when runner interactions must affect the result.

The engine does these steps for each tick:

1. Build one immutable field snapshot.
2. Derive order, pacer, proximity, and field views from the snapshot.
3. Resolve one `FieldInputs` value for each runner.
4. Update all runners against the same snapshot.
5. Route targeted effects.
6. Coordinate dueling and spot struggle.
7. Send lifecycle events to observers.

The standard race and contested comparison use cases accept 2 to 12 runners. The default standard field has nine runners, and contested comparison can add generated mob runners.

Primary code:

- `honse-sim/src/contested/race.rs`
- `honse-sim/src/contested/simulation.rs`
- `honse-sim/src/contested/collectors.rs`

## Vacuum engine

`honse_sim::vacuum` models a primary runner with synthetic field conditions. Use it for isolated comparisons where emergent field interaction is not necessary.

The engine uses approximate condition policies and configured dueling rates. It collects telemetry for the first `focus_count` runners only (default 1). A same-race vacuum compare passes 2 so both contestants pace off each other in one field. Context runners can affect race setup and do not increase the result payload.

Primary code:

- `honse-sim/src/vacuum/race.rs`
- `honse-sim/src/vacuum/simulation.rs`
- `honse-sim/src/vacuum/collectors.rs`

## Observer projections

Engines publish lifecycle events through `RaceObserver`. Collectors convert those events into finish orders, per-tick telemetry, skill activation ranges, targeted effects, and state-transition logs.

Keep simulation state separate from output projections. Add a collector when a consumer requests a new read model and existing observer events contain the necessary values.

Shared observer and projection code:

- `honse-sim/src/primitives/events.rs`
- `honse-sim/src/primitives/compare.rs`
- `honse-sim/src/primitives/projection.rs`

## Add a simulation use case

1. Choose the contested engine or the vacuum engine.
2. Define a Rust parameter type and result type in that engine.
3. Validate field size, sample count, and engine-specific settings before setup.
4. Construct one reusable race aggregate.
5. Attach observers before the sample loop.
6. Use `master_seed + round_index` for each round.
7. Call `prepare_round` before each run.
8. Add deterministic tests for equal seeds and seed-offset batches.
9. Add DTO conversion in `honse-sim-wasm` only for use cases that external consumers request.

Do not add consumer-side statistics or UI shaping to an engine. Return domain telemetry and let the consumer derive presentation-specific summaries.
