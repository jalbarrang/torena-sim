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
