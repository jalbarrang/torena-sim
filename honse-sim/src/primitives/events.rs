//! Lifecycle **domain events** and the [`RaceObserver`] port the aggregate emits
//! to.
//!
//! Port of `common/race-events.ts` (the `RaceEventBus` + `subscribeObserver`).
//! The `Race` aggregate (t-017) owns a [`RaceObservers`] dispatcher and emits at
//! each lifecycle point; read-model projection collectors (t-018) and the WASM
//! bridge implement [`RaceObserver`].
//!
//! Observers read live state through the [`RaceObservation`] / [`RunnerObservation`]
//! read-only view traits, which the aggregate and its runners implement. This is
//! the projection seam: this file defines only the lifecycle port + minimal
//! scalar payloads. The richer telemetry record (`race-event-log.ts`) is derived
//! by a projection in the application layer (t-018), not emitted here.

use crate::shared_kernel::ids::RunnerId;
use crate::stamina::ledger::StaminaLedger;

// `ActiveEffectView` is a pure projection value object; it was extracted into
// the shared primitives module (ADR-0005 step 4) alongside the effect-log reconciliation
// helpers. Re-exported here so existing `racing::events::ActiveEffectView` paths
// keep resolving.
pub use crate::projection::ActiveEffectView;

/// One entry from a runner's used-targeted-skill log.
#[derive(Debug, Clone, PartialEq)]
pub struct UsedTargetedView {
    /// Skill id that fired.
    pub skill_id: String,
    /// Position where it fired.
    pub position: f64,
    /// Effect type discriminant.
    pub effect_type: i32,
    /// Effect target discriminant.
    pub effect_target: i32,
}

/// A carried skill's instant (non-duration) effect, for point-activation logging.
#[derive(Debug, Clone, PartialEq)]
pub struct StaticEffectView {
    /// Skill id.
    pub skill_id: String,
    /// Effect type discriminant.
    pub effect_type: i32,
    /// Effect target discriminant.
    pub effect_target: i32,
}

/// Read-only view of the `Race` aggregate exposed to observers.
///
/// Methods have neutral defaults so lightweight test doubles can opt in to only
/// what they exercise; the real aggregate (t-017) overrides them.
pub trait RaceObservation {
    /// Total course distance in meters.
    fn course_distance(&self) -> f64 {
        0.0
    }
    /// The pacer's current position, if a pacer is selected.
    fn pacer_position(&self) -> Option<f64> {
        None
    }
    /// The current race order (1-based rank) of the given runner, if tracked.
    fn runner_order(&self, _id: RunnerId) -> Option<i64> {
        None
    }
    /// The seed driving the current round.
    fn seed(&self) -> u64 {
        0
    }
    /// Elapsed race time in seconds (drives event-log tick numbering).
    fn accumulated_time(&self) -> f64 {
        0.0
    }
    /// Widest lateral offset a runner can reach, in meters (the outer rail).
    fn max_lane_distance(&self) -> f64 {
        0.0
    }
}

/// Read-only view of a `Runner` entity exposed to observers.
///
/// Like [`RaceObservation`], every method has a neutral default. The projection
/// collectors (t-018) extend this view with whatever per-frame fields they
/// capture; the aggregate's `Runner` (t-013) implements them.
pub trait RunnerObservation {
    /// The runner's identity within the race.
    fn id(&self) -> RunnerId {
        RunnerId(0)
    }
    /// Elapsed race time in seconds.
    fn accumulate_time(&self) -> f64 {
        0.0
    }
    /// Longitudinal race position in meters.
    fn position(&self) -> f64 {
        0.0
    }
    /// Current speed in m/s.
    fn current_speed(&self) -> f64 {
        0.0
    }
    /// Current lateral lane offset.
    fn current_lane(&self) -> f64 {
        0.0
    }
    /// Current absolute HP.
    fn current_health(&self) -> f64 {
        0.0
    }
    /// Where this runner's HP went, when the stamina policy records it.
    fn stamina_ledger(&self) -> Option<StaminaLedger> {
        None
    }
    /// The runner's start delay in seconds.
    fn start_delay(&self) -> f64 {
        0.0
    }
    /// Running style as its numeric discriminant (1 Front Runner .. 5 Runaway).
    fn running_style(&self) -> i64 {
        0
    }
    /// Raw guts stat as entered.
    fn guts_stat(&self) -> i64 {
        0
    }
    /// Raw wit stat as entered.
    fn wit_stat(&self) -> i64 {
        0
    }
    /// Whether the runner has finished the round.
    fn finished(&self) -> bool {
        false
    }
    /// Finish time in seconds (0 until finished).
    fn finish_time(&self) -> f64 {
        0.0
    }
    /// Whether the runner is currently rushed (temptation).
    fn is_rushed(&self) -> bool {
        false
    }
    /// Whether the runner is currently dueling.
    fn is_dueling(&self) -> bool {
        false
    }
    /// Whether the runner is currently in a spot struggle.
    fn in_spot_struggle(&self) -> bool {
        false
    }
    /// Whether the runner is currently releasing Fully Charged acceleration.
    fn is_fully_charged(&self) -> bool {
        false
    }
    /// Fully Charged release region (`None` if it never triggered).
    fn fully_charged_region(&self) -> Option<(f64, f64)> {
        None
    }
    /// Fully Charged acceleration bonus (`None` if it never triggered).
    fn fully_charged_accel(&self) -> Option<f64> {
        None
    }
    /// Whether the runner has entered last spurt.
    fn is_last_spurt(&self) -> bool {
        false
    }
    /// Whether the runner has run out of HP.
    fn out_of_hp(&self) -> bool {
        false
    }
    /// Cumulative count of skills activated this round.
    fn skills_activated_count(&self) -> i64 {
        0
    }
    /// Current position-keep state as its numeric discriminant
    /// (0 None, 1 PaceUp, 2 PaceDown, 3 SpeedUp, 4 Overtake).
    fn position_keep_state(&self) -> i64 {
        0
    }
    /// Current race phase index (0 Early, 1 Mid, 2 Late, 3 Last-spurt leg).
    fn phase(&self) -> i64 {
        0
    }
    /// Whether the runner is currently overtaking (approximate condition).
    fn is_overtaking(&self) -> bool {
        false
    }
    /// Whether the runner is currently blocked on a side (approximate condition).
    fn is_side_blocked(&self) -> bool {
        false
    }
    /// Ids of skills the runner has used so far this round.
    fn used_skills(&self) -> Vec<&str> {
        Vec::new()
    }
    /// Total current-speed modifier (added to `current_speed` for true velocity).
    fn current_speed_modifier(&self) -> f64 {
        0.0
    }
    /// Self-cast duration effects currently active.
    fn active_effects(&self) -> Vec<ActiveEffectView> {
        Vec::new()
    }
    /// Externally-targeted duration effects currently active on this runner.
    fn targeted_active_effects(&self) -> Vec<ActiveEffectView> {
        Vec::new()
    }
    /// The runner's used-targeted-skill log (instant + duration entries).
    fn used_targeted_skills(&self) -> Vec<UsedTargetedView> {
        Vec::new()
    }
    /// The instant (non-duration) effects of every skill the runner carries.
    fn skill_static_effects(&self) -> Vec<StaticEffectView> {
        Vec::new()
    }
    /// Closed rushed `[start, end]` regions this round.
    fn rushed_activations(&self) -> Vec<(f64, f64)> {
        Vec::new()
    }
    /// Dueling start position (`-1.0` when never dueled).
    fn dueling_start_position(&self) -> f64 {
        -1.0
    }
    /// Dueling end position (`-1.0` when still open / never dueled).
    fn dueling_end_position(&self) -> f64 {
        -1.0
    }
    /// Spot-struggle start position (`None` when never entered).
    fn spot_struggle_start_position(&self) -> Option<f64> {
        None
    }
    /// Spot-struggle end position (`-1.0` when still open / never entered).
    fn spot_struggle_end_position(&self) -> f64 {
        -1.0
    }
    /// Whether the runner achieved a full last spurt.
    fn has_achieved_full_spurt(&self) -> bool {
        false
    }
    /// Distance-remaining when HP ran out, if it did.
    fn out_of_hp_position(&self) -> Option<f64> {
        None
    }
    /// Velocity shortfall when the last spurt was not full.
    fn non_full_spurt_velocity_diff(&self) -> Option<f64> {
        None
    }
    /// Delay distance when the last spurt was not full.
    fn non_full_spurt_delay_distance(&self) -> Option<f64> {
        None
    }
    /// Whether the runner held first position entering late race.
    fn first_position_in_late_race(&self) -> bool {
        false
    }
}

/// Discriminant of a lifecycle event, useful for telemetry / logging.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RaceEventKind {
    /// A round began.
    RoundStart,
    /// A simulation step is about to run.
    BeforeTick,
    /// A runner finished its step.
    AfterRunnerTick,
    /// A runner crossed the finish line.
    RunnerFinished,
    /// The round ended.
    RoundEnd,
}

/// A lifecycle event with its minimal scalar payload (no view references), for
/// observers that only need the discriminant + scalars (e.g. logging).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum RaceEvent {
    /// A round began with the given seed.
    RoundStart {
        /// The round seed.
        seed: u64,
    },
    /// A step of `dt` seconds is about to run.
    BeforeTick {
        /// Step duration in seconds.
        dt: f64,
    },
    /// `runner_id` finished a step of `dt` seconds.
    AfterRunnerTick {
        /// The runner that ticked.
        runner_id: RunnerId,
        /// Step duration in seconds.
        dt: f64,
    },
    /// `runner_id` crossed the finish line.
    RunnerFinished {
        /// The finishing runner.
        runner_id: RunnerId,
    },
    /// The round ended.
    RoundEnd,
}

impl RaceEvent {
    /// The discriminant of this event.
    pub fn kind(&self) -> RaceEventKind {
        match self {
            RaceEvent::RoundStart { .. } => RaceEventKind::RoundStart,
            RaceEvent::BeforeTick { .. } => RaceEventKind::BeforeTick,
            RaceEvent::AfterRunnerTick { .. } => RaceEventKind::AfterRunnerTick,
            RaceEvent::RunnerFinished { .. } => RaceEventKind::RunnerFinished,
            RaceEvent::RoundEnd => RaceEventKind::RoundEnd,
        }
    }
}

/// The observer **port**: implemented by read-model collectors and the WASM
/// bridge. Every method defaults to a no-op so observers override only the
/// events they care about (mirrors the TS `RaceLifecycleObserver`).
pub trait RaceObserver {
    /// A round started with `seed`.
    fn on_round_start(&mut self, _race: &dyn RaceObservation, _seed: u64) {}
    /// A step of `dt` seconds is about to run.
    fn on_before_tick(&mut self, _race: &dyn RaceObservation, _dt: f64) {}
    /// `runner` finished a step of `dt` seconds.
    fn on_after_runner_tick(
        &mut self,
        _race: &dyn RaceObservation,
        _runner: &dyn RunnerObservation,
        _dt: f64,
    ) {
    }
    /// `runner` crossed the finish line.
    fn on_runner_finished(&mut self, _race: &dyn RaceObservation, _runner: &dyn RunnerObservation) {
    }
    /// The round ended.
    fn on_round_end(&mut self, _race: &dyn RaceObservation) {}
}

/// The dispatcher the `Race` aggregate embeds: holds the subscribed observers
/// and fans each lifecycle emission out to all of them in subscription order.
///
/// Replaces the TS `RaceEventBus` + `subscribeObserver` pair with a direct
/// observer list (the bus only ever drove `RaceLifecycleObserver`s).
#[derive(Default)]
pub struct RaceObservers {
    observers: Vec<Box<dyn RaceObserver>>,
}

impl RaceObservers {
    /// An empty dispatcher.
    pub fn new() -> Self {
        RaceObservers {
            observers: Vec::new(),
        }
    }

    /// Register an observer.
    pub fn subscribe(&mut self, observer: Box<dyn RaceObserver>) {
        self.observers.push(observer);
    }

    /// Whether no observers are registered (lets the aggregate skip emission).
    pub fn is_empty(&self) -> bool {
        self.observers.is_empty()
    }

    /// Number of registered observers.
    pub fn len(&self) -> usize {
        self.observers.len()
    }

    /// Drop all observers.
    pub fn clear(&mut self) {
        self.observers.clear();
    }

    /// Emit `round-start`.
    pub fn emit_round_start(&mut self, race: &dyn RaceObservation, seed: u64) {
        for observer in &mut self.observers {
            observer.on_round_start(race, seed);
        }
    }

    /// Emit `before-tick`.
    pub fn emit_before_tick(&mut self, race: &dyn RaceObservation, dt: f64) {
        for observer in &mut self.observers {
            observer.on_before_tick(race, dt);
        }
    }

    /// Emit `after-runner-tick`.
    pub fn emit_after_runner_tick(
        &mut self,
        race: &dyn RaceObservation,
        runner: &dyn RunnerObservation,
        dt: f64,
    ) {
        for observer in &mut self.observers {
            observer.on_after_runner_tick(race, runner, dt);
        }
    }

    /// Emit `runner-finished`.
    pub fn emit_runner_finished(
        &mut self,
        race: &dyn RaceObservation,
        runner: &dyn RunnerObservation,
    ) {
        for observer in &mut self.observers {
            observer.on_runner_finished(race, runner);
        }
    }

    /// Emit `round-end`.
    pub fn emit_round_end(&mut self, race: &dyn RaceObservation) {
        for observer in &mut self.observers {
            observer.on_round_end(race);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::rc::Rc;

    struct TestRace;
    impl RaceObservation for TestRace {
        fn course_distance(&self) -> f64 {
            2400.0
        }
        fn seed(&self) -> u64 {
            7
        }
    }

    struct TestRunner(u32, f64);
    impl RunnerObservation for TestRunner {
        fn id(&self) -> RunnerId {
            RunnerId(self.0)
        }
        fn position(&self) -> f64 {
            self.1
        }
    }

    /// Shared log so a test can read what an owned (boxed) observer recorded.
    #[derive(Default)]
    struct Log {
        events: Vec<RaceEventKind>,
        positions: Vec<f64>,
        last_seed: u64,
    }

    struct CountingObserver {
        log: Rc<RefCell<Log>>,
    }

    impl RaceObserver for CountingObserver {
        fn on_round_start(&mut self, _race: &dyn RaceObservation, seed: u64) {
            let mut log = self.log.borrow_mut();
            log.events.push(RaceEventKind::RoundStart);
            log.last_seed = seed;
        }
        fn on_before_tick(&mut self, _race: &dyn RaceObservation, _dt: f64) {
            self.log.borrow_mut().events.push(RaceEventKind::BeforeTick);
        }
        fn on_after_runner_tick(
            &mut self,
            _race: &dyn RaceObservation,
            runner: &dyn RunnerObservation,
            _dt: f64,
        ) {
            let mut log = self.log.borrow_mut();
            log.events.push(RaceEventKind::AfterRunnerTick);
            log.positions.push(runner.position());
        }
        fn on_runner_finished(
            &mut self,
            _race: &dyn RaceObservation,
            _runner: &dyn RunnerObservation,
        ) {
            self.log
                .borrow_mut()
                .events
                .push(RaceEventKind::RunnerFinished);
        }
        fn on_round_end(&mut self, _race: &dyn RaceObservation) {
            self.log.borrow_mut().events.push(RaceEventKind::RoundEnd);
        }
    }

    #[test]
    fn default_observer_methods_are_noops() {
        struct Silent;
        impl RaceObserver for Silent {}
        let mut observers = RaceObservers::new();
        observers.subscribe(Box::new(Silent));
        // Emitting against the default impls must not panic.
        observers.emit_round_start(&TestRace, 1);
        observers.emit_round_end(&TestRace);
        assert_eq!(observers.len(), 1);
    }

    #[test]
    fn dispatcher_fans_out_full_lifecycle_in_order() {
        let log = Rc::new(RefCell::new(Log::default()));
        let mut observers = RaceObservers::new();
        observers.subscribe(Box::new(CountingObserver {
            log: Rc::clone(&log),
        }));

        let race = TestRace;
        let runner = TestRunner(2, 123.5);
        observers.emit_round_start(&race, 99);
        observers.emit_before_tick(&race, 0.0625);
        observers.emit_after_runner_tick(&race, &runner, 0.0625);
        observers.emit_runner_finished(&race, &runner);
        observers.emit_round_end(&race);

        let log = log.borrow();
        assert_eq!(log.last_seed, 99);
        assert_eq!(log.positions, vec![123.5]);
        assert_eq!(
            log.events,
            vec![
                RaceEventKind::RoundStart,
                RaceEventKind::BeforeTick,
                RaceEventKind::AfterRunnerTick,
                RaceEventKind::RunnerFinished,
                RaceEventKind::RoundEnd,
            ]
        );
    }

    #[test]
    fn dispatcher_fans_out_to_all_observers() {
        let log_a = Rc::new(RefCell::new(Log::default()));
        let log_b = Rc::new(RefCell::new(Log::default()));
        let mut observers = RaceObservers::new();
        observers.subscribe(Box::new(CountingObserver {
            log: Rc::clone(&log_a),
        }));
        observers.subscribe(Box::new(CountingObserver {
            log: Rc::clone(&log_b),
        }));
        observers.emit_round_start(&TestRace, 5);
        assert_eq!(log_a.borrow().last_seed, 5);
        assert_eq!(log_b.borrow().last_seed, 5);
        observers.clear();
        assert!(observers.is_empty());
    }

    #[test]
    fn race_event_kind_is_derived() {
        assert_eq!(
            RaceEvent::RoundStart { seed: 3 }.kind(),
            RaceEventKind::RoundStart
        );
        assert_eq!(
            RaceEvent::BeforeTick { dt: 0.1 }.kind(),
            RaceEventKind::BeforeTick
        );
        assert_eq!(RaceEvent::RoundEnd.kind(), RaceEventKind::RoundEnd);
    }
}
