//! # honse-sim-wasm
//!
//! WebAssembly adapter for `honse-sim`. [`dto`] translates
//! JavaScript-facing serde shapes into domain values. [`observer`] bridges the
//! domain's `RaceObserver` port to JavaScript callbacks.
//!
//! Build the normalized npm package with `./scripts/package-npm.sh`.

pub mod dto;
pub mod observer;

use wasm_bindgen::prelude::*;

use honse_sim::contested::race::Race;
use honse_sim::contested::{run_contested_compare, run_race_sim};
use honse_sim::readouts;
use honse_sim::shared_kernel::language::Strategy;
use honse_sim::vacuum::run_compare;

use crate::dto::{
    WasmCompareData, WasmCompareParams, WasmContestedCompareParams, WasmFinishEntry,
    WasmRaceSimParams, WasmRaceSimResult,
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
fn to_js<T: serde::Serialize>(value: &T) -> Result<JsValue, JsError> {
    let serializer = serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true);
    value
        .serialize(&serializer)
        .map_err(|e| JsError::new(&e.to_string()))
}

/// Run a batch race simulation and return the serialized result.
///
/// `params` is a [`WasmRaceSimParams`] JS object. Returns a
/// [`WasmRaceSimResult`] (per-round finish orders + focus telemetry).
#[wasm_bindgen(js_name = runRaceSim)]
pub fn run_race_sim_wasm(params: JsValue) -> Result<JsValue, JsError> {
    let dto: WasmRaceSimParams = from_js(params)?;
    let domain = dto
        .into_domain()
        .map_err(|e| JsError::new(&e.to_string()))?;
    let result = run_race_sim(domain).map_err(|e| JsError::new(&e.to_string()))?;
    to_js(&WasmRaceSimResult::from_domain(&result))
}

/// Run a batch compare-family simulation and return the serialized result.
///
/// `params` is a [`WasmCompareParams`] JS object (a small vacuum field over
/// `nsamples` rounds). Returns a [`WasmCompareData`] (per-round, per-runner
/// telemetry); the bashin-delta + summary stats are computed on the TS side.
#[wasm_bindgen(js_name = runCompare)]
pub fn run_compare_wasm(params: JsValue) -> Result<JsValue, JsError> {
    let dto: WasmCompareParams = from_js(params)?;
    let domain = dto
        .into_domain()
        .map_err(|e| JsError::new(&e.to_string()))?;
    let result = run_compare(domain).map_err(|e| JsError::new(&e.to_string()))?;
    to_js(&WasmCompareData::from_domain(&result))
}

/// Run a same-race compare-family simulation and return the serialized result.
///
/// `params` is a [`WasmContestedCompareParams`] JS object (2..=12 compared
/// runners, optionally mob-filled via `fillTo`). Returns the same [`WasmCompareData`] shape
/// as vacuum compare so the TS reducer can be reused.
#[wasm_bindgen(js_name = runContestedCompare)]
pub fn run_contested_compare_wasm(params: JsValue) -> Result<JsValue, JsError> {
    let dto: WasmContestedCompareParams = from_js(params)?;
    let domain = dto
        .into_domain()
        .map_err(|e| JsError::new(&e.to_string()))?;
    let result = run_contested_compare(domain).map_err(|e| JsError::new(&e.to_string()))?;
    to_js(&WasmCompareData::from_domain(&result))
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

/// The pre-race wisdom check pass rate, as a percentage, for a base wit stat.
///
/// See [`honse_sim::readouts::skill_activation_percent`].
#[wasm_bindgen(js_name = skillActivationPercent)]
pub fn skill_activation_percent_wasm(base_wit: f64) -> f64 {
    readouts::skill_activation_percent(base_wit)
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

    /// Run the configured rounds, firing callbacks live, and return the
    /// serialized [`WasmRaceSimResult`].
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

        let result = WasmRaceSimResult {
            finish_orders,
            collected: Vec::new(),
            event_logs: Vec::new(),
            replays: Vec::new(),
        };
        to_js(&result)
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
