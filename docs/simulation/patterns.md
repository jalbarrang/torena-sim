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

## Capture accuracy harness

`honse-sim-wasm/tests/capture_accuracy.rs` replays real game races through the contested engine and scores the result against the game's own replay. It is the feedback loop for reducing model error: every fixture is one race the game actually ran.

A fixture holds two things:

- The `WasmRaceSimParams` a downstream would send for that race, with every runner pinned to its recorded gate and start delay through `CreateRunner::gate` and `CreateRunner::forced_start_delay`.
- The decoded `RaceSimulateData` payload: per-frame distance, speed, and HP, per-runner results, and every skill activation with its time.

torena-hub's `pnpm run race:fixture <horseACT capture> --out honse-sim-wasm/tests/fixtures/captures` writes them. The Rust side only reads JSON, so the game data decoder and skill resolution stay outside this workspace.

Each fixture runs twice over `ACCURACY_SAMPLES` seeds (default 8, deterministic). `ACCURACY_FIXTURE=<substring>` narrows a run to matching files, and a higher sample count is the right tool when digging into one race. The engine packages build with `opt-level = 3` under the test profile so the suite stays under a minute.

- **free**: the engine rolls skill activations itself. This scores the whole model, randomness included, against one drawn outcome, so it is noisy by construction.
- **pinned**: skills the game fired are forced at the recorded distance with `forced_positions`, skills it never fired are removed, the last spurt starts at the recorded distance through `CreateRunner::forced_last_spurt_distance`, rushed spells run where the game recorded them through `forced_rushed_regions` with the engine's own rushed roll disabled, and downhill mode runs where the recorded HP drain shows its 0.4 factor through `forced_downhill_regions` with the per-second roll disabled. What remains is deterministic (speed, acceleration, HP) plus the rolls the replay never records, so a pinned residual is either a formula error, one of those rolls, or a field interaction such as blocking.

Scores per run: finish time MAE and bias, winner hit rate, Spearman rank correlation of the finish order, spurt start MAE, skill activation error, and per-frame trajectory, speed, HP and lane MAE and bias over the recorded frames. Lane is in meters from the rail; the replay's `lane_position` is 10000 units per course width, as in the game's capture. Frames are matched by time, not index: the engine's replay starts at the first tick while the game records a frame at 0. A per-runner breakdown prints under each pinned run with speed and HP bias per race phase, so an aggregate points at a runner and a phase.

The harness runs locally only: the test is `#[ignore]`d and runs with `cargo test -p honse-sim-wasm --test capture_accuracy -- --ignored --nocapture`. `baseline.json` stores the last accepted scores. The test fails when finish time MAE or trajectory MAE regress past a small tolerance. Accept a new baseline with `UPDATE_ACCURACY_BASELINE=1` only in the change that moves the mechanics, and say why in that change.

Outcomes the replay does not record and the engine still rolls in pinned mode: per-section wit variance and dueling. Lane position and the blocking runner are recorded but have no seam; the per-runner report prints the blocked share per phase for the game and the engine side by side, which is where the closers' late-race speed excess shows up as overtaking time. The recorded spurt distance pins the transition only; the spurt speed follows from the HP formula for that transition.

The engine's replay records a frame at time 0, the prepared field standing in the gates, and then one per tick, the same shape as the game's capture. Collectors receive it through `RaceObserver::on_runner_prepared`.

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
