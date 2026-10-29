# Simulation patterns

## Shared runner kernel

The `honse-sim` crate contains shared primitives and two engine modules. Each engine resolves `FieldInputs`, then calls the same runner step kernel. The kernel does not inspect the engine or ask if a live field exists.

Each tick uses a fixed duration of 1/15 second. Each round uses a deterministic seed and resets reusable state before the first tick.

### Per-tick allocation discipline

The tick is the hot path: a 100-sample run is roughly 100 x 1200 ticks x field-size runner steps, so anything allocated per runner per tick is allocated hundreds of thousands of times. Both engines therefore reuse engine-owned state instead of allocating in the loop.

- `Race::field_views` holds one `FieldView` per runner, refilled in place each tick by `race_support::refill_field_view`. A view carries two series projected from the frozen snapshot (`other_snapshots`, `active_runners`); rebuilding them per runner per tick was O(n^2) allocations per tick.
- `FieldOrderTracker::runner_order` is a dense `OrderMap` indexed by `RunnerId`, not a `HashMap`. Ids are assigned densely from zero and runners are never removed, so a lookup is an array index; the tick rebuilds the map and clones it once instead of hashing it and cloning twice.
- Finished membership is a `u64` bitmask (`Race::finished_mask`) over those same dense ids, so "has this runner finished?" is O(1) rather than a scan of `finished_runners` per runner.
- `RunnerView::other_snapshots` and `active_runners` return `&[T]` borrowed from the view. Conditions read them many times per tick (once per pending skill per runner), so returning an owned `Vec` allocated on every evaluation.
- Field ordering uses `sort_unstable_by` with an explicit ascending-`RunnerId` tiebreak. That reproduces the previous stable sort's tie order (entries are built in id order) without the merge sort's temporary allocation, so it is not a behaviour change.

Measured on the 53 captured races in `honse-sim-wasm/tests/fixtures/captures/`
(real builds, median 18 skills per runner, 9 runners per race), 8 rounds each:
the contested engine went from 39.2 to 20.7 ms/round (-47%).

That is two separate wins, and the second one is much larger than the first. The
kernel work above is worth about -8% on its own; everything else came from the
read-model collectors. Per round, before and after:

| Stage | before | after |
|---|---|---|
| engine kernel, no observers | 7.0 | 7.1 |
| `RaceSimDataCollector`, every runner focused | +21.7 | +4.7 |
| `RaceEventLogCollector` | +8.2 | +10.0 |
| site-shaped run (both collectors, focus = full field) | 37.5 | 22.3 |

So the projections, not the kernel, dominate a real simulation, and the kernel is
now only about a third of one. The site always pays the telemetry cost:
`raceSimParamsToWasm` forces `focusRunnerIds` to the whole field so the result
adapter can rebuild every runner's position and lane traces.

What made `RaceSimDataCollector` cheap:

- The focus set is a dense runner-id-to-trace-slot table built once, not a
  `contains` scan plus a `find` per runner per tick.
- The instant-effect log is gated on the runner's activation counter. It used to
  call `skill_static_effects`, which materialises every effect of every carried
  skill with a `String` clone each (~72 entries for 18 skills), on every tick for
every focused runner, when only a tick that actually activated something can
consume it.
- `reconcile_effects` closes logs with `retain` instead of cloning every open key
  into a scratch `Vec` each tick.

The event log is now the largest single component and is the next thing to
attack.

A flat-mob field measures very differently (7.6 ms/round at nine runners),
because mobs carry no skills and the snapshot machinery is then a large share of
a much smaller total. Benchmark against the captured races, not a synthetic
field.

### Telemetry must not depend on hash order

`count_effects` returns a `BTreeMap`, not a `HashMap`, and that is load-bearing.
`reconcile_effects` opens logs by iterating that map and hands each one the next
`execution_id`, so hash iteration order decided which activation got which id and
the order of logs sharing a skill id. Two runs of the same seed produced
different telemetry. Sorted iteration makes the read model reproducible; the
keys are small and few, so the ordered map costs nothing measurable.

This is the same class of bug the approximate-condition tick documents: anywhere
a `HashMap` is iterated into an ordered output or an RNG stream, the order is
part of the result. Make it explicit or make it sorted.

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

### Lane movement

Over a live field the runner step resolves its target lane with the documented rules (`honse-sim/src/primitives/runner/lane.rs`): vision cone, overtake targets, candidate lanes around each target's crowd scored by distance with the early-race outside penalty, the six normal-mode rules, the extra move lane from the final corner, a 1.5 s overtake linger, the overlap bump, and side blocking as the test for whether a move is possible. Front blocking caps speed at 0.988 to 1.0 times the blocker's speed. The doc measures lanes in course widths; the engine keeps meters and scales the doc's constants (lane change speed, the inward drift, the final-corner lane) by the course width where it reads them. Two numbers are named as assumptions in that module: the longitudinal reach of the "inside uma" in normal-mode rule 5 (3 m, the crowd distance) and the pace-down target lane 0.18 read as meters against the doc's unit, because the captures score worse with it in widths (`honse-sim-wasm/tests/capture_accuracy.rs`). The vacuum engine keeps its approximate lane path; `FieldInputs::lane_neighbors` is `None` there.

## Vacuum engine

`honse_sim::vacuum` models a primary runner with synthetic field conditions. Use it for isolated comparisons where emergent field interaction is not necessary.

The engine uses approximate condition policies and configured dueling rates. Dueling stays synthetic; spot struggle runs the shared coordinator (`honse-sim/src/primitives/spot_struggle.rs`) over the runners who are actually present, so the mechanic behaves the same in both engines and simply sees a smaller field. It collects telemetry for the first `focus_count` runners only (default 1). A same-race vacuum compare passes 2 so both contestants pace off each other in one field. Context runners can affect race setup and do not increase the result payload.

Primary code:

- `honse-sim/src/vacuum/race.rs`
- `honse-sim/src/vacuum/simulation.rs`
- `honse-sim/src/vacuum/collectors.rs`
- `honse-sim/src/primitives/spot_struggle.rs` (shared with the contested engine)

### Synced RNG

The vacuum engine accepts `sync_rng_runners`, a per-runner list naming the runners that should develop from one RNG stream: the first named runner draws the stream seeds and every later named runner reuses them, so a compared pair rolls the same rushed check, the same wit checks, and the same downhill / lane / dueling draws. Unnamed runners always keep their own stream, and the list has no field-wide default, because syncing a pacer or a mob would make it race identically to the pair. Classic compare names its pair; the site exposes the switch as "Force synced RNG" in Advanced Settings, off by default. Vacuum mode needs no switch, since it races each uma in its own batch on the same master seed and the streams already line up. The contested engine has no equivalent: it races a live field, where the margin comes from blocking and lanes rather than luck.

Measured on Hanshin 1600m, 300 samples, identical builds: with the pair synced, rounds where the two runners activated different skill sets fell from 101/300 to 0/300, and the identical-build gap in classic compare fell from 1.21 to 0.13 mean lengths, sd 1.60 → 0.33. Identical streams are still not identical timing: the two runners sit at different positions, so they consume their streams at different moments and drift apart from there. The feature aligns draws, not trajectories.

### Isolated skill placement

The game picks every skill's pre-race activation region from one skill PRNG while walking the runner's skills in id order (`mechanics § x_random`, `§ activate_count_x`). Adding a skill therefore re-rolls the placement of every skill after it, which is faithful but makes a measured marginal a measurement of the whole build: on the Chukyo 1200 CM, adding one corner skill moved a cooldown skill's window by up to 550 m in a reference simulator.

`isolate_skill_rng` is the compare-path exception. When set, each skill samples its own placement from a seed derived from `(runner seed, skill id)`, so the window is stable across builds. The shared stream still advances exactly as before — runtime consumers (`MultiplyRandom` value scaling, forced gold activation) read it, and skipping those draws moved per-frame HP on 52 of 53 captures. With one seed and one skill, isolation reproduces the designed window.

It is a deliberate deviation, not a mechanics claim: the capture harness cannot tell the two apart (53 fixtures, 32 seeds, every graded channel a wash), so the game's stream topology is unobservable from race output. Compare Skills, Compare Uniques, the planner and the ranker turn it on; Race Sim, Classic/Contested compare and the capture fixtures leave it off. `honse-sim/tests/skill_rng_isolation.rs` gates both directions.

## Observer projections

Engines publish lifecycle events through `RaceObserver`. Collectors convert those events into finish orders, per-tick telemetry, skill activation ranges, targeted effects, and state-transition logs.

Keep simulation state separate from output projections. Add a collector when a consumer requests a new read model and existing observer events contain the necessary values.

### On-demand replay projection

The replay projection (`honse-sim/src/contested/replay.rs`) records every gate on every tick, which makes it the heaviest read model: on a nine-runner field it is roughly 40% of a 100-round run's engine time. The batch use case therefore takes `RaceSimParams::include_replays`, and the WASM `runRaceSim` leaves it `false`. A caller that wants frames asks for one round through `run_race_replay`, which regenerates that round on its own.

`run_race_replay` reproduces the batch run's own round rather than merely a race of the same seed. `Race::prepare_round_at` pins the round counter that selects the sampled skill-trigger window (`realizations[round_iteration % len]`), which otherwise depends on how many rounds ran before it.

The WASM adapter packs the round into the capture's packed little-endian bytes (`honse-sim-wasm/src/replay_bytes.rs`) and returns one `Uint8Array`, so a round never becomes one JavaScript object per gate per frame. The site decodes it with `decodeRaceSimData`, the same reader a captured race goes through. `replay_bytes.rs` and the site's `encodeRaceScenarioBytes` (`src/modules/race-sim/share/race-scenario.ts`) must agree byte for byte; a golden-bytes test on each side pins the layout.

### Read-model series cross as typed arrays

Every bulk per-tick series crosses the WASM boundary as a `Float32Array` (and integer channels as `Int32Array`) instead of letting serde build one JS array per channel. This covers the compare read models (`runCompare`, `runContestedCompare`, `runPlannerCompare`, `runBasinCompare` — `compare_data_to_js`, `position_data_to_js`, `basin_data_to_js`) and the race-sim focus telemetry (`collected_to_js`, `race_sim_result_to_js`).

The consumers hold these payloads for every sampled round — the compare worker accumulates them before reducing, and the race-sim result keeps every round for the track view and the charts — so the series dominate memory. Measured:

| payload | rounds | series | held as typed arrays | held before |
|---|---|---|---|---|
| compare, one runner | 500 | 3.0M numbers | 12.0 MB external + ~1 MB heap | ~35 MB on the JS heap |
| race-sim focus, nine runners | 100 | 3.9M numbers | 15.4 MB external + ~4 MB heap | one object per sample per tick |

The compare call is also about 20% faster. The engine still computes in `f64` — only these read models narrow, and the largest quantisation error measured over 100 compare rounds is 6.1e-5 m on position, 9.5e-7 m/s on velocity, and 1.8e-6 s on time. A regression back to `number[]` or per-sample objects would still typecheck, so `tests/typed-read-model-series.test.ts` pins the contract at runtime.

### Compare reduces in the engine

A comparison is read as a summary plus four races per panel, so `runCompare`
returning every round made the boundary carry a batch to compute a dozen
numbers. `primitives/compare_summary.rs` owns that reduction now: the bashin
deltas, mechanic spans, stamina spreads, ledger means, and per-skill activation
profiles.

`WasmCompareAccumulator` is a mergeable accumulator. Each `run*` call races its
chunk inside the engine and folds it in, so nothing crosses per chunk; `merge`
combines chunks in Rust; `finish` returns the summary. The summary names the
sample behind each statistic, and the consumer re-runs those rounds through
`roundIndices` — the same index-pinned entry point `runRaceReplay` uses. Twelve
rounds instead of 500, and one implementation for every consumer of the engine.

Two invariants hold the numbers still:

- The accumulator keeps per-round ledger rows and sums them in round order at
  `finish`, so a chunked batch reduces to the same mean one pass would. Float
  addition is not associative, and a `+=` per chunk would drift in the last bits.
- The delta and the HP spreads are measured on the **transported** values
  (`f32`-narrowed position and hp), not the engine's own `f64`, so a summary
  agrees bit for bit with a consumer that diffs the series it received.

### The lean reductions (skill basin, planner)

The skill/unique basin and the skill planner ask narrower questions and get
leaner read models for it (`runBasinCompare`, `runPlannerCompare`). Their
reductions live in `primitives/skill_bashin.rs`: the bashin delta (whole race or
a window of it), the tracked skill's activation metadata, and the confidence
summary. Both entry points reuse a baseline the caller would otherwise re-run
per candidate, so the baseline arrives as a read model and is wrapped in an
engine handle (`WasmSkillBaseline`, `WasmPositionBaseline`): `summarize` races
the candidate inside the engine and returns statistics, and `payloads` rebuilds
only the four races a chart draws, by index.

The window delta is the same one `vacuum/ranking.rs` measures, so the ranker,
the basin, and the planner can no longer disagree about what a skill was worth.

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

Each fixture runs twice over `ACCURACY_SAMPLES` seeds (default 8, deterministic). The harness sets `RaceSimParams::include_replays` (the batch app endpoint leaves it off) because it scores the per-frame trajectory. `ACCURACY_FIXTURE=<substring>` narrows a run to matching files, and a higher sample count is the right tool when digging into one race. The engine packages build with `opt-level = 3` under the test profile so the suite stays under a minute.

- **free**: the engine rolls skill activations itself. This scores the whole model, randomness included, against one drawn outcome, so it is noisy by construction.
- **pinned**: skills the game fired are forced at the recorded distance with `forced_positions`, skills it never fired are removed, the last spurt starts at the recorded distance through `CreateRunner::forced_last_spurt_distance`, rushed spells run where the game recorded them through `forced_rushed_regions` with the engine's own rushed roll disabled, and downhill mode runs where the recorded HP drain shows its 0.4 factor through `forced_downhill_regions` with the per-second roll disabled. What remains is deterministic (speed, acceleration, HP) plus the rolls the replay never records, so a pinned residual is either a formula error, one of those rolls, or a field interaction such as blocking.

Scores per run: finish time MAE and bias, winner hit rate, Spearman rank correlation of the finish order, spurt start MAE, skill activation error, and, over the recorded frames, trajectory MAE, speed and HP MAE and bias, and lane MAE. Lane is in meters from the rail; the replay's `lane_position` is 10000 units per course width, as in the game's capture. Frames are matched by time, not index: the engine's replay starts at the first tick while the game records a frame at 0. A per-runner breakdown prints under each pinned run with speed and HP bias per race phase, so an aggregate points at a runner and a phase.

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
