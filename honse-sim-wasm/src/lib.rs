//! # honse-sim-wasm
//!
//! WebAssembly adapter for `honse-sim`. [`dto`] translates
//! JavaScript-facing serde shapes into domain values. [`observer`] bridges the
//! domain's `RaceObserver` port to JavaScript callbacks.
//!
//! Build the normalized npm package with `./scripts/package-npm.sh`.

pub mod dto;
pub mod observer;
pub mod replay_bytes;

use wasm_bindgen::prelude::*;

use honse_sim::compare::{BasinRound, PositionRound};
use honse_sim::compare_summary::CompareSummary;
use honse_sim::contested::collectors::CollectedData;
use honse_sim::contested::race::Race;
use honse_sim::contested::{
    run_contested_compare, run_contested_compare_rounds, run_race_replay, run_race_sim,
};
use honse_sim::readouts;
use honse_sim::shared_kernel::language::Strategy;
use honse_sim::skill_bashin::{bashin_between, skill_run_payload, SkillCompareSummary};
use honse_sim::vacuum::collectors::BasinData;
use honse_sim::vacuum::{
    rank_skills, run_basin_compare, run_basin_compare_indices, run_compare, run_compare_rounds,
    run_paired_compare_rounds, run_position_compare,
};

use crate::dto::{
    WasmCompareParams, WasmContestedCompareParams, WasmFinishEntry, WasmPairedCompareParams,
    WasmRaceReplayParams, WasmRaceSimParams, WasmSkillRankData, WasmSkillRankParams,
    WasmStaminaBudget, WasmStaminaBudgetParams,
};
use crate::observer::JsObserver;

/// Deserialize a JS value into a typed DTO.
fn from_js<T: serde::de::DeserializeOwned>(value: JsValue) -> Result<T, JsError> {
    serde_wasm_bindgen::from_value(value).map_err(|e| JsError::new(&e.to_string()))
}

/// Serialize a value back to JS.
///
/// Maps are serialized as plain JS objects (not ES `Map`s) so the TypeScript
/// side can read `HashMap` outputs (e.g. compare `skillActivations`) as the
/// `Record<string, …>` shape its types declare. The default
/// `serde_wasm_bindgen::to_value` emits ES `Map`s, which made
/// `Object.values(skillActivations)` silently empty (Bug #1).
pub(crate) fn to_js<T: serde::Serialize>(value: &T) -> Result<JsValue, JsError> {
    let serializer = serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true);
    value
        .serialize(&serializer)
        .map_err(|e| JsError::new(&e.to_string()))
}

/// Serialize a value whose absent optionals the caller reads as `null`.
///
/// `serde_wasm_bindgen` maps `None` to `undefined` by default, which a consumer
/// checking `!== null` would mistake for a present value. The compare summary's
/// spreads are explicitly nullable, so they cross as `null`.
pub(crate) fn to_js_nullable<T: serde::Serialize>(value: &T) -> Result<JsValue, JsError> {
    let serializer = serde_wasm_bindgen::Serializer::new()
        .serialize_maps_as_objects(true)
        .serialize_missing_as_null(true);
    value
        .serialize(&serializer)
        .map_err(|e| JsError::new(&e.to_string()))
}

/// Run a batch race simulation and return the serialized result.
///
/// `params` is a [`WasmRaceSimParams`] JS object. Returns a plain JS object:
/// per-round finish orders, the focus telemetry, and the event logs, with every
/// per-tick series carried as a typed array (`Float32Array`) instead of one
/// object per sample. Replays are not included — call
/// [`runRaceReplay`](run_race_replay_wasm) for one round's frames.
#[wasm_bindgen(js_name = runRaceSim)]
pub fn run_race_sim_wasm(params: JsValue) -> Result<JsValue, JsError> {
    let dto: WasmRaceSimParams = from_js(params)?;
    let domain = dto
        .into_domain()
        .map_err(|e| JsError::new(&e.to_string()))?;
    let result = run_race_sim(domain).map_err(|e| JsError::new(&e.to_string()))?;
    dto::race_sim_result_from_domain(&result)
}

/// Run one round and return its replay as packed capture bytes.
///
/// `params` is a [`WasmRaceReplayParams`] JS object: the same fields as
/// [`runRaceSim`](run_race_sim_wasm) plus the absolute `roundIndex` to
/// reproduce. Returns a
/// `Uint8Array` in the game's own `RaceSimulateData` layout, so a consumer
/// decodes a simulated round with the same reader it uses for a captured race
/// and never handles one JavaScript object per gate per frame.
///
/// The round is regenerated from `masterSeed + roundIndex`, so it is the batch
/// run's own round rather than a race of the same seed.
#[wasm_bindgen(js_name = runRaceReplay)]
pub fn run_race_replay_wasm(params: JsValue) -> Result<js_sys::Uint8Array, JsError> {
    let dto: WasmRaceReplayParams = from_js(params)?;
    let domain = dto
        .into_domain()
        .map_err(|e| JsError::new(&e.to_string()))?;
    let replay = run_race_replay(domain).map_err(|e| JsError::new(&e.to_string()))?;
    Ok(js_sys::Uint8Array::from(
        replay_bytes::encode_replay_bytes(&replay).as_slice(),
    ))
}

/// Run a batch compare-family simulation and return the serialized result.
///
/// `params` is a [`WasmCompareParams`] JS object (a small vacuum field over
/// `nsamples` rounds). Returns a plain JS object holding round metadata plus the
/// per-runner series as typed arrays (`Float32Array` / `Int32Array`).
///
/// Pass `roundIndices` to run only those rounds: round `i` is seeded
/// `masterSeed + i` and pins its own round counter, so one index reproduces that
/// exact round of the batch without replaying the ones before it. That is how a
/// summary's representative races are materialised without carrying a whole
/// batch across the boundary.
#[wasm_bindgen(js_name = runCompare)]
pub fn run_compare_wasm(params: JsValue) -> Result<JsValue, JsError> {
    let dto: WasmCompareParams = from_js(params)?;
    let indices = dto.round_indices.clone();
    let domain = dto
        .into_domain()
        .map_err(|e| JsError::new(&e.to_string()))?;
    let result = match indices.as_slice() {
        [] => run_compare(domain),
        named => run_compare_rounds(domain, named),
    }
    .map_err(|e| JsError::new(&e.to_string()))?;
    dto::compare_data_to_js(&result)
}

/// Run a position-only compare-family simulation and return the serialized result.
///
/// `params` is a [`WasmCompareParams`] JS object, the same shape
/// [`runCompare`](run_compare_wasm) takes. Returns per-round focus-runner
/// positions only, as typed arrays. The skill planner's bashin delta reads nothing else, so this
/// drops the velocity/HP/lane/order/effect channels and the per-tick effect
/// reconciliation the full compare read model carries.
#[wasm_bindgen(js_name = runPlannerCompare)]
pub fn run_planner_compare_wasm(params: JsValue) -> Result<JsValue, JsError> {
    let dto: WasmCompareParams = from_js(params)?;
    let domain = dto
        .into_domain()
        .map_err(|e| JsError::new(&e.to_string()))?;
    let result = run_position_compare(domain).map_err(|e| JsError::new(&e.to_string()))?;
    dto::position_data_to_js(&result)
}

/// Run a lean compare-family simulation for the skill/unique basin.
///
/// `params` is a [`WasmCompareParams`] JS object, the same shape
/// [`runCompare`](run_compare_wasm) takes. Returns per-round
/// time/position/velocity, self-cast activation logs, used skills, and finish
/// position only, as typed arrays. The basin
/// reduction reads nothing else, so this drops the HP/lane/pacer/order channels,
/// targeted activations, and mechanic regions the full compare read model
/// carries. Compare Runners still uses [`runCompare`](run_compare_wasm) for those.
///
/// Pass `roundIndices` to run only those rounds.
#[wasm_bindgen(js_name = runBasinCompare)]
pub fn run_basin_compare_wasm(params: JsValue) -> Result<JsValue, JsError> {
    let dto: WasmCompareParams = from_js(params)?;
    let indices = dto.round_indices.clone();
    let domain = dto
        .into_domain()
        .map_err(|e| JsError::new(&e.to_string()))?;
    let result = match indices.as_slice() {
        [] => run_basin_compare(domain),
        named => run_basin_compare_indices(domain, Some(named)),
    }
    .map_err(|e| JsError::new(&e.to_string()))?;
    dto::basin_data_to_js(&result)
}

/// Rank candidate skills by their marginal bashin over a baseline runner.
///
/// `params` is a [`WasmSkillRankParams`] JS object: the baseline runner plus a
/// list of candidate skills. The engine appends each candidate, computes the
/// per-sample bashin delta internally, and returns only per-candidate stats, so
/// no per-sample telemetry crosses back. The baseline is simulated once.
#[wasm_bindgen(js_name = runSkillRank)]
pub fn run_skill_rank_wasm(params: JsValue) -> Result<JsValue, JsError> {
    let dto: WasmSkillRankParams = from_js(params)?;
    let domain = dto
        .into_domain()
        .map_err(|e| JsError::new(&e.to_string()))?;
    let result = rank_skills(&domain).map_err(|e| JsError::new(&e.to_string()))?;
    to_js(&WasmSkillRankData::from_domain(&result))
}

/// Run a same-race compare-family simulation and return the serialized result.
///
/// `params` is a [`WasmContestedCompareParams`] JS object (2..=12 compared
/// runners, optionally mob-filled via `fillTo`). Returns the same shape
/// [`runCompare`](run_compare_wasm) does. Pass `roundIndices` to run only those
/// rounds.
#[wasm_bindgen(js_name = runContestedCompare)]
pub fn run_contested_compare_wasm(params: JsValue) -> Result<JsValue, JsError> {
    let dto: WasmContestedCompareParams = from_js(params)?;
    let indices = dto.round_indices.clone();
    let domain = dto
        .into_domain()
        .map_err(|e| JsError::new(&e.to_string()))?;
    let result = match indices.as_slice() {
        [] => run_contested_compare(domain),
        named => run_contested_compare_rounds(domain, named),
    }
    .map_err(|e| JsError::new(&e.to_string()))?;
    dto::compare_data_to_js(&result)
}

/// A mergeable reduction of one compare batch, owned by the caller.
///
/// Each `run*` call races its chunk inside the engine and folds it in, so no
/// per-round telemetry crosses the boundary and the bashin deltas, stamina
/// spreads, and activation profiles are computed once, in Rust. Accumulate the
/// chunks in whatever split they ran, then read `finish()`; the representative
/// races it names are materialised afterwards through `roundIndices`.
#[wasm_bindgen]
#[derive(Default)]
pub struct WasmCompareAccumulator {
    inner: CompareSummary,
}

#[wasm_bindgen]
impl WasmCompareAccumulator {
    /// An empty accumulator.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self::default()
    }

    /// Race one vacuum/classic chunk and fold it in.
    ///
    /// The first two focus runners are the compared pair, which is what both
    /// the classic (one field, two focused runners) and same-race modes arrange.
    #[wasm_bindgen(js_name = runField)]
    pub fn run_field(&mut self, params: JsValue) -> Result<(), JsError> {
        let dto: WasmCompareParams = from_js(params)?;
        let domain = dto
            .into_domain()
            .map_err(|e| JsError::new(&e.to_string()))?;
        let data = run_compare(domain).map_err(|e| JsError::new(&e.to_string()))?;
        self.inner
            .observe_batch(&data, 0, 1)
            .map_err(|e| JsError::new(&e.to_string()))
    }

    /// Race one contested chunk and fold it in.
    #[wasm_bindgen(js_name = runContested)]
    pub fn run_contested(&mut self, params: JsValue) -> Result<(), JsError> {
        let dto: WasmContestedCompareParams = from_js(params)?;
        let domain = dto
            .into_domain()
            .map_err(|e| JsError::new(&e.to_string()))?;
        let data = run_contested_compare(domain).map_err(|e| JsError::new(&e.to_string()))?;
        self.inner
            .observe_batch(&data, 0, 1)
            .map_err(|e| JsError::new(&e.to_string()))
    }

    /// Race each contestant in its own field and fold the paired rounds in.
    #[wasm_bindgen(js_name = runPaired)]
    pub fn run_paired(&mut self, params: JsValue) -> Result<(), JsError> {
        let dto: WasmPairedCompareParams = from_js(params)?;
        let (first, second) = dto
            .into_domain()
            .map_err(|e| JsError::new(&e.to_string()))?;
        let paired = run_paired_compare_rounds(first, second, None)
            .map_err(|e| JsError::new(&e.to_string()))?;
        self.inner
            .observe_paired_batch(&paired)
            .map_err(|e| JsError::new(&e.to_string()))
    }

    /// Fold another accumulator into this one, keeping sample order.
    pub fn merge(&mut self, other: &WasmCompareAccumulator) {
        self.inner.merge(other.inner.clone());
    }

    /// The finished read-model: deltas, spans, stamina spreads, and profiles.
    pub fn finish(&self) -> Result<JsValue, JsError> {
        to_js_nullable(&self.inner.to_data())
    }
}

/// A skill-comparison baseline, held in the engine.
///
/// The baseline runner is identical across every candidate in a basin run, so it
/// is simulated once and reused. Parsing it here means each candidate's tracked
/// run is reduced inside the engine and only the summary comes back: a
/// candidate's per-tick telemetry never crosses the boundary, and both sides are
/// measured by the same code.
#[wasm_bindgen]
pub struct WasmSkillBaseline {
    rounds: Vec<BasinRound>,
}

#[wasm_bindgen]
impl WasmSkillBaseline {
    /// Parse the baseline read model (`runBasinCompare`'s rounds).
    #[wasm_bindgen(constructor)]
    pub fn new(baseline: JsValue) -> Result<WasmSkillBaseline, JsError> {
        let dto: dto::WasmBasinBaseline = from_js(baseline)?;
        Ok(WasmSkillBaseline {
            rounds: dto.into_domain(),
        })
    }

    /// Run the tracked runner and reduce it against this baseline.
    ///
    /// `params` is a `WasmSkillCompareParams`: the tracked field, the tracked
    /// skill id, the fallback effect, and the stretch of the race to score.
    pub fn summarize(&self, params: JsValue) -> Result<JsValue, JsError> {
        let dto: dto::WasmSkillCompareParams = from_js(params)?;
        let fallback = dto.fallback();
        let window = dto.window();
        let tracked_skill_id = dto.tracked_skill_id.clone();
        let tracked = run_tracked_basin(dto, None)?;

        let mut summary = SkillCompareSummary::new();
        for (baseline, tracked_round) in self.rounds.iter().zip(tracked.rounds.iter()) {
            summary
                .observe(baseline, tracked_round, &tracked_skill_id, fallback, window)
                .map_err(|e| JsError::new(&e.to_string()))?;
        }

        to_js_nullable(&summary.finish())
    }

    /// Chart payloads for the named rounds of a tracked run.
    ///
    /// The same `WasmSkillCompareParams` as `summarize`, plus `roundIndices`:
    /// the rounds a finished summary named. Each is re-run from its seed and
    /// pinned to its own round counter, so these are the batch's own races.
    #[wasm_bindgen(js_name = payloads)]
    pub fn payloads(&self, params: JsValue) -> Result<JsValue, JsError> {
        let dto: dto::WasmSkillCompareParams = from_js(params)?;
        let fallback = dto.fallback();
        let tracked_skill_id = dto.tracked_skill_id.clone();
        let indices = dto.round_indices.clone();
        let tracked = run_tracked_basin(dto, Some(indices.as_slice()))?;

        let mut payloads = Vec::with_capacity(tracked.rounds.len());
        for (position, tracked_round) in tracked.rounds.iter().enumerate() {
            let index = indices.get(position).copied().ok_or_else(|| {
                JsError::new("payloads returned more rounds than the indices it was given")
            })?;
            let baseline = self.rounds.get(index).ok_or_else(|| {
                JsError::new(&format!(
                    "round {index} is outside the {}-round baseline",
                    self.rounds.len()
                ))
            })?;
            payloads.push(
                skill_run_payload(baseline, tracked_round, &tracked_skill_id, fallback)
                    .map_err(|e| JsError::new(&e.to_string()))?,
            );
        }

        to_js(&payloads)
    }
}

/// Run the tracked field of a skill comparison, or only `indices` of it.
fn run_tracked_basin(
    dto: dto::WasmSkillCompareParams,
    indices: Option<&[usize]>,
) -> Result<BasinData, JsError> {
    let domain = dto
        .params
        .into_domain()
        .map_err(|e| JsError::new(&e.to_string()))?;
    run_basin_compare_indices(domain, indices).map_err(|e| JsError::new(&e.to_string()))
}

/// A position-only baseline, held in the engine.
///
/// The skill planner races a candidate against a baseline it reuses across
/// combinations. Holding the baseline's positions here means each candidate is
/// raced and reduced inside the engine, so only the bashin summary crosses.
#[wasm_bindgen]
pub struct WasmPositionBaseline {
    rounds: Vec<PositionRound>,
}

#[wasm_bindgen]
impl WasmPositionBaseline {
    /// Parse the baseline read model (`runPlannerCompare`'s rounds).
    #[wasm_bindgen(constructor)]
    pub fn new(baseline: JsValue) -> Result<WasmPositionBaseline, JsError> {
        let dto: dto::WasmPositionBaseline = from_js(baseline)?;
        Ok(WasmPositionBaseline {
            rounds: dto.into_domain(),
        })
    }

    /// Race one candidate and summarise its bashin deltas against this baseline.
    pub fn summarize(&self, params: JsValue) -> Result<JsValue, JsError> {
        let dto: WasmCompareParams = from_js(params)?;
        let domain = dto
            .into_domain()
            .map_err(|e| JsError::new(&e.to_string()))?;
        let candidate = run_position_compare(domain).map_err(|e| JsError::new(&e.to_string()))?;
        let summary = bashin_between(&self.rounds, &candidate.rounds)
            .map_err(|e| JsError::new(&e.to_string()))?;
        to_js(&summary)
    }
}

/// All condition tokens the Rust engine's catalog recognizes.
///
/// Exposed so an external consumer can cross-check its simulatability gate
/// against the engine that runs the simulation. Any token a consumer treats as
/// simulatable must be resolvable by this engine.
/// Returned as a sorted JS string array.
#[wasm_bindgen(js_name = knownConditionTokens)]
pub fn known_condition_tokens_wasm() -> Vec<String> {
    let mut tokens: Vec<String> = honse_sim::skills::condition::catalog::known_condition_tokens()
        .into_iter()
        .collect();
    tokens.sort();
    tokens
}

/// Which of the submitted skills this engine models only partially.
///
/// `skills` is an array of the same skill objects a simulation takes. Returns one
/// entry per skill that loses at least one effect, each listing the dropped
/// effects and whether the skill is left inert; a fully modeled skill is omitted,
/// so an empty array means full coverage.
///
/// The engine drops effects it cannot model rather than rejecting the skill —
/// an unmapped effect `type` (what it does), `valueUsage` (how much), or `target`
/// (who receives it), or a tiered usage that did not state the
/// `preAppliedMultiplier` already folded into its modifier — so a simulation
/// always runs, but a dropped effect makes that skill's contribution understated.
/// Exposed so a consumer can say which skills are affected instead of presenting
/// partial results as complete.
///
/// The answer is a property of the skill data alone, so call it once per skill
/// pool rather than per simulation. It accepts a whole pool: no unmapped code in
/// any submitted skill can make this throw.
#[wasm_bindgen(js_name = skillSupportReport)]
pub fn skill_support_report_wasm(skills: JsValue) -> Result<JsValue, JsError> {
    let dto: Vec<dto::WasmSkillInput> = from_js(skills)?;
    let report = dto::build_skill_support_report(&dto).map_err(|e| JsError::new(&e.to_string()))?;
    to_js(&report)
}

/// Resolve a game strategy id (1-5) into the domain enum.
fn strategy_from_id(strategy: u8) -> Result<Strategy, JsError> {
    match strategy {
        1 => Ok(Strategy::FrontRunner),
        2 => Ok(Strategy::PaceChaser),
        3 => Ok(Strategy::LateSurger),
        4 => Ok(Strategy::EndCloser),
        5 => Ok(Strategy::Runaway),
        other => Err(JsError::new(&format!(
            "unknown strategy id {other}; expected 1-5"
        ))),
    }
}

/// Stamina's HP conversion coefficient for a strategy id (1-5).
///
/// See [`honse_sim::readouts::hp_strategy_coefficient`].
#[wasm_bindgen(js_name = hpStrategyCoefficient)]
pub fn hp_strategy_coefficient_wasm(strategy: u8) -> Result<f64, JsError> {
    Ok(readouts::hp_strategy_coefficient(strategy_from_id(
        strategy,
    )?))
}

/// The HP a runner starts a race with, from stamina, strategy id, and course
/// distance in meters.
///
/// See [`honse_sim::readouts::max_hp`].
#[wasm_bindgen(js_name = maxHp)]
pub fn max_hp_wasm(stamina: f64, strategy: u8, distance: f64) -> Result<f64, JsError> {
    Ok(readouts::max_hp(
        stamina,
        strategy_from_id(strategy)?,
        distance,
    ))
}

/// The late-race HP consumption multiplier for a guts stat.
///
/// See [`honse_sim::readouts::guts_hp_burn_multiplier`].
#[wasm_bindgen(js_name = gutsHpBurnMultiplier)]
pub fn guts_hp_burn_multiplier_wasm(guts: f64) -> f64 {
    readouts::guts_hp_burn_multiplier(guts)
}

/// Price a build's HP against a course without running a race.
///
/// `params` is a [`WasmStaminaBudgetParams`] JS object; the result is a
/// [`WasmStaminaBudget`]. Max HP, the last-spurt threshold, and the guts burn
/// multiplier all come from the functions the engines themselves call, so an
/// answer here and an answer from a race cannot drift apart.
///
/// See [`honse_sim::readouts::stamina_budget`].
#[wasm_bindgen(js_name = staminaBudget)]
pub fn stamina_budget_wasm(params: JsValue) -> Result<JsValue, JsError> {
    let dto: WasmStaminaBudgetParams = from_js(params)?;
    let input = dto
        .into_domain()
        .map_err(|e| JsError::new(&e.to_string()))?;

    to_js(&WasmStaminaBudget::from(readouts::stamina_budget(&input)))
}

/// The pre-race wisdom check pass rate, as a percentage, for a base wit stat.
///
/// See [`honse_sim::readouts::skill_activation_percent`].
#[wasm_bindgen(js_name = skillActivationPercent)]
pub fn skill_activation_percent_wasm(base_wit: f64) -> f64 {
    readouts::skill_activation_percent(base_wit)
}

/// The ground a finish-time gap is worth, in meters (`delta * 15 m/s`).
///
/// See [`honse_sim::readouts::finish_gap_meters`].
#[wasm_bindgen(js_name = finishGapMeters)]
pub fn finish_gap_meters_wasm(delta_seconds: f64) -> f64 {
    readouts::finish_gap_meters(delta_seconds)
}

/// The photo-finish margin name for a finish-time gap: `"nose"`, `"head"`,
/// `"neck"`, or `undefined` when the gap is wider than a neck.
///
/// See [`honse_sim::readouts::finish_margin`].
#[wasm_bindgen(js_name = finishMargin)]
pub fn finish_margin_wasm(delta_seconds: f64) -> Option<String> {
    readouts::finish_margin(delta_seconds).map(str::to_owned)
}

/// A streaming race simulator with per-event JS callbacks.
///
/// Construct with [`WasmRaceSimulator::new`], register callbacks, then call
/// [`run`](WasmRaceSimulator::run) to drive the race aggregate over the
/// configured rounds. Callbacks fire live; the serialized batch result is
/// returned at the end.
#[wasm_bindgen]
pub struct WasmRaceSimulator {
    params: WasmRaceSimParams,
    observer: JsObserver,
}

#[wasm_bindgen]
impl WasmRaceSimulator {
    /// Build a simulator from a [`WasmRaceSimParams`] JS object.
    #[wasm_bindgen(constructor)]
    pub fn new(params: JsValue) -> Result<WasmRaceSimulator, JsError> {
        let params: WasmRaceSimParams = from_js(params)?;
        Ok(WasmRaceSimulator {
            params,
            observer: JsObserver::default(),
        })
    }

    /// Register the `round-start(seed)` callback.
    #[wasm_bindgen(js_name = setOnRoundStart)]
    pub fn set_on_round_start(&mut self, cb: js_sys::Function) {
        self.observer.on_round_start = Some(cb);
    }

    /// Register the `before-tick(dt)` callback.
    #[wasm_bindgen(js_name = setOnBeforeTick)]
    pub fn set_on_before_tick(&mut self, cb: js_sys::Function) {
        self.observer.on_before_tick = Some(cb);
    }

    /// Register the `after-runner-tick(snapshot)` callback.
    #[wasm_bindgen(js_name = setOnAfterRunnerTick)]
    pub fn set_on_after_runner_tick(&mut self, cb: js_sys::Function) {
        self.observer.on_after_runner_tick = Some(cb);
    }

    /// Register the `runner-finished(runnerId)` callback.
    #[wasm_bindgen(js_name = setOnRunnerFinished)]
    pub fn set_on_runner_finished(&mut self, cb: js_sys::Function) {
        self.observer.on_runner_finished = Some(cb);
    }

    /// Register the `round-end()` callback.
    #[wasm_bindgen(js_name = setOnRoundEnd)]
    pub fn set_on_round_end(&mut self, cb: js_sys::Function) {
        self.observer.on_round_end = Some(cb);
    }

    /// Run the configured rounds, firing callbacks live, and return the same
    /// serialized shape [`runRaceSim`](run_race_sim_wasm) does.
    pub fn run(self) -> Result<JsValue, JsError> {
        let WasmRaceSimulator { params, observer } = self;
        let focus_ids = params.focus_runner_ids.clone();
        let domain = params
            .into_domain()
            .map_err(|e| JsError::new(&e.to_string()))?;

        let settings = domain.settings.clone();
        let mut race = Race::new(domain.course, domain.ground, settings, domain.parameters);
        for runner in domain.runners {
            race.add_runner(runner);
        }
        race.subscribe(Box::new(observer));

        // Drive the rounds directly so callbacks fire (mirrors run_race_sim).
        let mut finish_orders = Vec::with_capacity(domain.nsamples);
        for i in 0..domain.nsamples {
            race.prepare_round(domain.master_seed + i as u64);
            race.run();
            finish_orders.push(collect_finish(&race));
        }
        let _ = focus_ids;

        dto::race_sim_result_to_js(finish_orders, &CollectedData::default(), &Vec::new())
    }
}

fn collect_finish(race: &Race) -> Vec<WasmFinishEntry> {
    race.finished_runners()
        .iter()
        .filter_map(|&id| {
            race.runners()
                .iter()
                .find(|r| r.id == id)
                .map(|runner| WasmFinishEntry {
                    runner_id: id.0,
                    name: runner.name.clone(),
                    strategy: runner.strategy as i32,
                    finish_position: runner.position,
                    finish_time: runner.finish_time,
                })
        })
        .collect()
}
