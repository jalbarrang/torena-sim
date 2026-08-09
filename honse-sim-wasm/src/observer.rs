//! `JsObserver` — bridges the domain [`RaceObserver`] port to optional JS
//! callbacks. Each lifecycle event forwards to a stored `js_sys::Function`,
//! serializing the per-runner snapshot through `serde-wasm-bindgen`.

use js_sys::Function;
use serde::Serialize;
use wasm_bindgen::JsValue;

use honse_sim::events::{RaceObservation, RaceObserver, RunnerObservation};

/// The per-tick snapshot handed to the `after_runner_tick` JS callback.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunnerTickSnapshot {
    /// Runner id.
    pub runner_id: u32,
    /// Elapsed race time in seconds.
    pub time: f64,
    /// Longitudinal position in meters.
    pub position: f64,
    /// Current speed in m/s.
    pub speed: f64,
    /// Lateral lane offset.
    pub lane: f64,
    /// Remaining absolute HP.
    pub health: f64,
    /// Whether the runner has finished.
    pub finished: bool,
}

impl RunnerTickSnapshot {
    fn from_obs(runner: &dyn RunnerObservation) -> Self {
        RunnerTickSnapshot {
            runner_id: runner.id().0,
            time: runner.accumulate_time(),
            position: runner.position(),
            speed: runner.current_speed(),
            lane: runner.current_lane(),
            health: runner.current_health(),
            finished: runner.finished(),
        }
    }
}

/// A [`RaceObserver`] that forwards lifecycle events to JS callbacks.
///
/// Every callback is optional; missing callbacks are skipped. Serialization /
/// call errors are swallowed (a misbehaving callback must not abort the race).
#[derive(Default)]
pub struct JsObserver {
    /// `round-start(seed)`.
    pub on_round_start: Option<Function>,
    /// `before-tick(dt)`.
    pub on_before_tick: Option<Function>,
    /// `after-runner-tick(snapshot)`.
    pub on_after_runner_tick: Option<Function>,
    /// `runner-finished(runnerId)`.
    pub on_runner_finished: Option<Function>,
    /// `round-end()`.
    pub on_round_end: Option<Function>,
}

fn call1(f: &Function, arg: &JsValue) {
    let _ = f.call1(&JsValue::NULL, arg);
}

impl RaceObserver for JsObserver {
    fn on_round_start(&mut self, _race: &dyn RaceObservation, seed: u64) {
        if let Some(f) = &self.on_round_start {
            call1(f, &JsValue::from_f64(seed as f64));
        }
    }

    fn on_before_tick(&mut self, _race: &dyn RaceObservation, dt: f64) {
        if let Some(f) = &self.on_before_tick {
            call1(f, &JsValue::from_f64(dt));
        }
    }

    fn on_after_runner_tick(
        &mut self,
        _race: &dyn RaceObservation,
        runner: &dyn RunnerObservation,
        _dt: f64,
    ) {
        if let Some(f) = &self.on_after_runner_tick {
            let snapshot = RunnerTickSnapshot::from_obs(runner);
            if let Ok(value) = serde_wasm_bindgen::to_value(&snapshot) {
                call1(f, &value);
            }
        }
    }

    fn on_runner_finished(&mut self, _race: &dyn RaceObservation, runner: &dyn RunnerObservation) {
        if let Some(f) = &self.on_runner_finished {
            call1(f, &JsValue::from_f64(f64::from(runner.id().0)));
        }
    }

    fn on_round_end(&mut self, _race: &dyn RaceObservation) {
        if let Some(f) = &self.on_round_end {
            let _ = f.call0(&JsValue::NULL);
        }
    }
}
