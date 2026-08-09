//! Runtime (dynamic) condition predicate + the live-race view trait it observes.
//!
//! In the TypeScript engine a dynamic condition is `(runner: Runner) => boolean`
//! evaluated each tick. Here it is a boxed closure over the [`RunnerView`] trait,
//! which is the anti-corruption seam: the skills context observes live race state
//! without depending on the `racing` module. `RunnerView` is intentionally empty
//! for now and is fleshed out by the full-sim condition work (t-009).

use std::collections::HashMap;
use std::fmt;
use std::sync::{Arc, LazyLock, Once, RwLock};

use crate::shared_kernel::language::Strategy;
use crate::skills::condition::operator::CmpKind;

/// A point-in-time snapshot of another runner, as observed during a tick.
///
/// Mirrors the TypeScript `RunnerSnapshot` (`position` / `currentLane` /
/// `currentSpeed`) used by the blocking and proximity conditions.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RunnerSnapshot {
    /// Longitudinal race position in meters.
    pub position: f64,
    /// Current lateral lane offset.
    pub current_lane: f64,
    /// Current speed in m/s.
    pub current_speed: f64,
}

/// Live state of an active (non-finished) runner, used by the state conditions
/// (temptation / dueling counts). Includes the observing runner itself, flagged
/// via [`is_self`](ActiveRunner::is_self) so `includeSelf=false` predicates can
/// skip it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ActiveRunner {
    /// Whether this entry is the observing runner.
    pub is_self: bool,
    /// Longitudinal race position in meters.
    pub position: f64,
    /// Running style.
    pub strategy: Strategy,
    /// Gate (post) number; gate `0` marks the popularity-one runner.
    pub gate: i64,
    /// Whether the runner is currently rushed (temptation).
    pub is_rushed: bool,
    /// Whether the runner is currently in a duel.
    pub is_dueling: bool,
    /// Bitmask of positive self-applied effect types this runner has activated
    /// (bit `n` => SkillType id `n`). Read by
    /// `is_other_character_activate_advantage_skill`.
    pub activated_advantage_effect_types: u64,
}

/// Compare a numeric value against an argument under a [`CmpKind`].
///
/// Faithful port of the TypeScript `compare(value, arg, cmp)` helper; uses exact
/// floating comparison by design (the engine compares integral orders/counts and
/// derived ratios the same way).
#[allow(
    clippy::float_cmp,
    reason = "exact comparison is intentional: ports the TS `compare` oracle which \
               compares integral orders/counts and identically-derived ratios; \
               approximate comparison would diverge from the parity reference"
)]
pub fn compare(value: f64, arg: f64, cmp: CmpKind) -> bool {
    match cmp {
        CmpKind::Eq => value == arg,
        CmpKind::Neq => value != arg,
        CmpKind::Lt => value < arg,
        CmpKind::Lte => value <= arg,
        CmpKind::Gt => value > arg,
        CmpKind::Gte => value >= arg,
    }
}

/// Map a boolean predicate to the `0`/`1` numeric value the engine compares.
pub fn bool_num(value: bool) -> f64 {
    if value {
        1.0
    } else {
        0.0
    }
}

/// Read-only view of a live runner that dynamic conditions evaluate against.
///
/// This is the anti-corruption contract the skills context reads live state
/// through; implemented by the `racing` context's `Runner` (t-013+). Methods
/// have defaults (neutral values) so lightweight test doubles can opt in to only
/// what they exercise; the real `Runner` overrides all of them.
pub trait RunnerView {
    /// Elapsed race time in seconds (`accumulateTime.t`).
    fn accumulate_time(&self) -> f64 {
        0.0
    }
    /// Total number of skills activated so far.
    fn skills_activated_count(&self) -> i64 {
        0
    }
    /// Number of skills activated during the given phase index (0..=2).
    fn skills_activated_in_phase(&self, _phase: usize) -> i64 {
        0
    }
    /// Number of skills activated during the given half of the race (0 = first,
    /// 1 = second).
    fn skills_activated_half_race(&self, _half: usize) -> i64 {
        0
    }
    /// Number of recovery (heal) skills activated.
    fn heals_activated_count(&self) -> i64 {
        0
    }
    /// Fraction of HP remaining (0.0..=1.0).
    fn health_ratio_remaining(&self) -> f64 {
        1.0
    }
    /// Whether the runner still has HP left.
    fn has_remaining_health(&self) -> bool {
        true
    }
    /// Whether a skill with the given id has been used.
    fn has_used_skill(&self, _skill_id: &str) -> bool {
        false
    }
    /// The runner's start delay in seconds.
    fn start_delay(&self) -> f64 {
        0.0
    }
    /// Whether the runner is in last spurt.
    fn is_last_spurt(&self) -> bool {
        false
    }
    /// Last-spurt transition marker (`-1` when not transitioned).
    fn last_spurt_transition(&self) -> f64 {
        -1.0
    }
    /// The runner's gate (post) number.
    fn gate(&self) -> i64 {
        0
    }
    /// The runner's random-lot roll.
    fn random_lot(&self) -> i64 {
        0
    }

    // --- full-sim live state (t-009; implemented by the racing `Runner`) ---

    /// Longitudinal race position in meters.
    fn position(&self) -> f64 {
        0.0
    }
    /// Current lateral lane offset.
    fn current_lane(&self) -> f64 {
        0.0
    }
    /// Current speed in m/s.
    fn current_speed(&self) -> f64 {
        0.0
    }
    /// Rate of lateral lane change (non-zero while moving lanes).
    fn lane_change_speed(&self) -> f64 {
        0.0
    }
    /// The course's per-horse lane width (`course.horseLane`).
    fn horse_lane(&self) -> f64 {
        0.0
    }
    /// The course section length (`course.distance / 24`).
    fn section_length(&self) -> f64 {
        0.0
    }
    /// The total course distance in meters.
    fn course_distance(&self) -> f64 {
        0.0
    }
    /// The current race phase index (0..=2).
    fn phase(&self) -> i64 {
        0
    }
    /// The runner's running style, if known.
    fn strategy(&self) -> Option<Strategy> {
        None
    }
    /// Whether the runner is currently rushed (temptation).
    fn is_rushed(&self) -> bool {
        false
    }
    /// Whether the runner is currently dueling.
    fn is_dueling(&self) -> bool {
        false
    }
    /// The runner's current finishing order (1-based), if assigned.
    fn current_order(&self) -> Option<i64> {
        None
    }
    /// The runner's order on the previous tick, if assigned.
    fn previous_order(&self) -> Option<i64> {
        None
    }
    /// The number of runners in the race.
    fn num_umas(&self) -> i64 {
        0
    }
    /// The leader's (order-1) position in meters, if known.
    fn leader_position(&self) -> Option<f64> {
        None
    }
    /// Snapshots of every other active runner (excludes self).
    fn other_snapshots(&self) -> Vec<RunnerSnapshot> {
        Vec::new()
    }
    /// Live state of every active (non-finished) runner, including self.
    fn active_runners(&self) -> Vec<ActiveRunner> {
        Vec::new()
    }
}

/// A runtime predicate gating a skill's activation, evaluated each tick.
///
/// Cloning is cheap (shared `Arc`). There is deliberately no `PartialEq`: closure
/// identity is not meaningful. The "no extra condition" case is modeled as
/// `Option::<DynamicCondition>::None` rather than a sentinel value (see
/// [`ConditionResult`](super::ConditionResult)).
#[derive(Clone)]
pub struct DynamicCondition(Arc<DynCondFn>);

/// The boxed predicate type behind a [`DynamicCondition`].
type DynCondFn = dyn Fn(&dyn RunnerView) -> bool + Send + Sync;

impl DynamicCondition {
    /// Wrap a predicate closure.
    pub fn new(f: impl Fn(&dyn RunnerView) -> bool + Send + Sync + 'static) -> Self {
        DynamicCondition(Arc::new(f))
    }

    /// The trivial always-true condition (`kTrue`). Prefer representing "no
    /// condition" as `None`; this materializes it when a concrete value is
    /// required.
    pub fn k_true() -> Self {
        DynamicCondition::new(|_| true)
    }

    /// Evaluate the predicate against a live runner view.
    pub fn eval(&self, runner: &dyn RunnerView) -> bool {
        (self.0)(runner)
    }
}

impl fmt::Debug for DynamicCondition {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("DynamicCondition(..)")
    }
}

/// Evaluate an optional dynamic condition; `None` means always-true (`kTrue`).
pub fn eval_dynamic(cond: &Option<DynamicCondition>, runner: &dyn RunnerView) -> bool {
    cond.as_ref().is_none_or(|c| c.eval(runner))
}

/// Builds a [`DynamicCondition`] for a given comparison argument + operator.
/// Populated by the full-sim/approximate condition work (t-009).
pub type DynamicConditionFactory = fn(arg: i64, cmp: CmpKind) -> DynamicCondition;

static REGISTRY: LazyLock<RwLock<HashMap<&'static str, DynamicConditionFactory>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

/// Register a dynamic-condition factory under `name` (called during setup).
pub fn register_dynamic_condition(name: &'static str, factory: DynamicConditionFactory) {
    if let Ok(mut guard) = REGISTRY.write() {
        guard.insert(name, factory);
    }
}

/// Look up a registered dynamic-condition factory.
pub fn get_dynamic_condition(name: &str) -> Option<DynamicConditionFactory> {
    REGISTRY
        .read()
        .ok()
        .and_then(|guard| guard.get(name).copied())
}

/// Whether a dynamic condition is registered for `name`.
pub fn has_dynamic_condition(name: &str) -> bool {
    get_dynamic_condition(name).is_some()
}

static REGISTER_ALL: Once = Once::new();

/// Populate the dynamic-condition registry with every full-sim factory.
///
/// Idempotent (guarded by [`Once`]); the catalog/application calls this once
/// before resolving conditions under `Dynamic` resolution. Mirrors the
/// TypeScript `registerAllDynamicConditions`.
pub fn register_all_dynamic_conditions() {
    REGISTER_ALL.call_once(|| {
        super::order::register_order_conditions();
        super::proximity::register_proximity_conditions();
        super::blocking::register_blocking_conditions();
        super::state::register_state_conditions();
    });
}
