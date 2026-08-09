//! Approximate (Markov start/continue) conditions used in compare mode, e.g.
//! `blocked_side` and `overtake`.
//!
//! Port of `conditions/aproximate-conditions.ts` + `conditions/special-conditions.ts`.
//! In compare mode the full-sim dynamic predicates are unavailable, so these
//! model the condition as a two-state Markov chain: a `start_rate` chance of
//! switching on while inactive, and a `continuation_rate` chance of staying on
//! once active. Each tick advances the chain via a [`Prng`] draw.

use crate::shared_kernel::language::Strategy;
use crate::shared_kernel::rng::Prng;

/// The slice of runner state an approximate condition's predicates read.
///
/// Mirrors the TypeScript `ConditionState` (which wrapped the whole `Runner`),
/// narrowed to just the fields the bundled predicates use.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ApproximateConditionState {
    /// Current race phase index (0..=2).
    pub phase: i64,
    /// Longitudinal race position in meters.
    pub position: f64,
    /// Section length (`course.distance / 24`).
    pub section_length: f64,
    /// Current lateral lane offset.
    pub current_lane: f64,
    /// Per-horse lane width (`course.horseLane`).
    pub horse_lane: f64,
    /// Running style.
    pub strategy: Strategy,
}

/// A Markov start/continue approximate condition.
///
/// `value_on_start` seeds the chain; `update` advances it each tick, returning
/// `1` (active) or `0` (inactive).
pub trait ApproximateCondition {
    /// The chain's initial value.
    fn value_on_start(&self) -> i32;
    /// Advance the chain one tick given its current value.
    fn update(
        &self,
        state: &ApproximateConditionState,
        current_value: i32,
        rng: &mut dyn Prng,
    ) -> i32;
}

/// A single-rate Markov chain: `start_rate` to switch on, `continuation_rate` to
/// stay on.
#[derive(Debug, Clone)]
pub struct ApproximateStartContinue {
    /// Human-readable label (matches the TypeScript condition name).
    pub name: String,
    /// Probability of turning on while inactive.
    pub start_rate: f64,
    /// Probability of staying on while active.
    pub continuation_rate: f64,
}

impl ApproximateStartContinue {
    /// Build a start/continue chain.
    pub fn new(name: impl Into<String>, start_rate: f64, continuation_rate: f64) -> Self {
        ApproximateStartContinue {
            name: name.into(),
            start_rate,
            continuation_rate,
        }
    }

    /// The rate that applies given the current value.
    fn rate_for(&self, current_value: i32) -> f64 {
        if current_value == 0 {
            self.start_rate
        } else {
            self.continuation_rate
        }
    }
}

impl ApproximateCondition for ApproximateStartContinue {
    fn value_on_start(&self) -> i32 {
        0
    }

    fn update(
        &self,
        _state: &ApproximateConditionState,
        current_value: i32,
        rng: &mut dyn Prng,
    ) -> i32 {
        i32::from(rng.random() < self.rate_for(current_value))
    }
}

/// Predicate selecting which sub-condition applies for a given state. `None`
/// marks the fallback entry.
type EntryPredicate = Option<Box<dyn Fn(&ApproximateConditionState) -> bool + Send + Sync>>;

/// One branch of an [`ApproximateMultiCondition`]: a chain plus the predicate
/// that activates it (or `None` for the fallback).
pub struct ConditionEntry {
    /// The chain used when this entry is selected.
    pub condition: ApproximateStartContinue,
    /// Predicate gating this entry; `None` is the fallback.
    pub predicate: EntryPredicate,
}

/// A Markov condition whose start/continue rates depend on runner state: the
/// first matching predicate's chain is used, falling back to the `None` entry.
pub struct ApproximateMultiCondition {
    /// Human-readable label.
    pub name: String,
    /// Branches, evaluated in order.
    pub conditions: Vec<ConditionEntry>,
    /// The chain's initial value.
    pub value_on_start: i32,
}

impl ApproximateMultiCondition {
    /// Build a multi-branch approximate condition.
    pub fn new(
        name: impl Into<String>,
        conditions: Vec<ConditionEntry>,
        value_on_start: i32,
    ) -> Self {
        ApproximateMultiCondition {
            name: name.into(),
            conditions,
            value_on_start,
        }
    }

    /// Select the chain to use for `state`: the first matching predicate wins,
    /// otherwise the fallback (`None` predicate) entry.
    fn select(&self, state: &ApproximateConditionState) -> Option<&ApproximateStartContinue> {
        let mut fallback: Option<&ApproximateStartContinue> = None;
        for entry in &self.conditions {
            match &entry.predicate {
                None => fallback = Some(&entry.condition),
                Some(predicate) if predicate(state) => return Some(&entry.condition),
                Some(_) => {}
            }
        }
        fallback
    }
}

impl ApproximateCondition for ApproximateMultiCondition {
    fn value_on_start(&self) -> i32 {
        self.value_on_start
    }

    fn update(
        &self,
        state: &ApproximateConditionState,
        current_value: i32,
        rng: &mut dyn Prng,
    ) -> i32 {
        match self.select(state) {
            Some(condition) => i32::from(rng.random() < condition.rate_for(current_value)),
            None => current_value,
        }
    }
}

/// Build the `blocked_side` approximate condition (compare-mode fallback for the
/// full-sim side-blocking predicate).
pub fn create_blocked_side_condition() -> ApproximateMultiCondition {
    let conditions = vec![
        ConditionEntry {
            condition: ApproximateStartContinue::new("Outer lane", 0.0, 0.0),
            predicate: Some(Box::new(|state: &ApproximateConditionState| {
                let section = (state.position / state.section_length).floor() as i64;
                (1..=3).contains(&section) && state.current_lane > 3.0 * state.horse_lane
            })),
        },
        ConditionEntry {
            condition: ApproximateStartContinue::new("Early race", 0.1, 0.85),
            predicate: Some(Box::new(|state: &ApproximateConditionState| {
                state.phase == 0
            })),
        },
        ConditionEntry {
            condition: ApproximateStartContinue::new("Mid race", 0.08, 0.75),
            predicate: Some(Box::new(|state: &ApproximateConditionState| {
                state.phase == 1
            })),
        },
        ConditionEntry {
            condition: ApproximateStartContinue::new("Other", 0.07, 0.5),
            predicate: None,
        },
    ];
    ApproximateMultiCondition::new("blocked_side", conditions, 1)
}

/// Build the `overtake` approximate condition (compare-mode fallback for the
/// full-sim overtake predicate).
pub fn create_overtake_condition() -> ApproximateMultiCondition {
    let conditions = vec![
        ConditionEntry {
            condition: ApproximateStartContinue::new("逃げ", 0.05, 0.5),
            predicate: Some(Box::new(|state: &ApproximateConditionState| {
                state.strategy == Strategy::FrontRunner
            })),
        },
        ConditionEntry {
            condition: ApproximateStartContinue::new("先行", 0.15, 0.55),
            predicate: Some(Box::new(|state: &ApproximateConditionState| {
                state.strategy == Strategy::PaceChaser
            })),
        },
        ConditionEntry {
            condition: ApproximateStartContinue::new("その他", 0.2, 0.6),
            predicate: None,
        },
    ];
    ApproximateMultiCondition::new("overtake", conditions, 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state(
        phase: i64,
        position: f64,
        lane: f64,
        strategy: Strategy,
    ) -> ApproximateConditionState {
        ApproximateConditionState {
            phase,
            position,
            section_length: 100.0,
            current_lane: lane,
            horse_lane: 1.0,
            strategy,
        }
    }

    /// A deterministic PRNG stub returning a fixed value for `random()`.
    struct FixedRng(f64);
    impl Prng for FixedRng {
        fn int32(&mut self) -> u32 {
            0
        }
        fn random(&mut self) -> f64 {
            self.0
        }
        fn uniform(&mut self, _upper: u32) -> u32 {
            0
        }
    }

    #[test]
    fn start_continue_switches_on_below_start_rate() {
        let cond = ApproximateStartContinue::new("x", 0.3, 0.9);
        let s = state(0, 0.0, 0.0, Strategy::FrontRunner);
        assert_eq!(cond.update(&s, 0, &mut FixedRng(0.2)), 1);
        assert_eq!(cond.update(&s, 0, &mut FixedRng(0.4)), 0);
        // Once active, continuation_rate applies.
        assert_eq!(cond.update(&s, 1, &mut FixedRng(0.85)), 1);
        assert_eq!(cond.update(&s, 1, &mut FixedRng(0.95)), 0);
    }

    #[test]
    fn blocked_side_selects_phase_branch() {
        let cond = create_blocked_side_condition();
        assert_eq!(cond.value_on_start(), 1);

        // Early race (phase 0), inner lane -> start_rate 0.1.
        let early = state(0, 500.0, 0.0, Strategy::FrontRunner);
        assert_eq!(cond.update(&early, 0, &mut FixedRng(0.05)), 1);
        assert_eq!(cond.update(&early, 0, &mut FixedRng(0.5)), 0);

        // Mid race continuation_rate 0.75.
        let mid = state(1, 500.0, 0.0, Strategy::FrontRunner);
        assert_eq!(cond.update(&mid, 1, &mut FixedRng(0.7)), 1);
        assert_eq!(cond.update(&mid, 1, &mut FixedRng(0.8)), 0);
    }

    #[test]
    fn blocked_side_outer_lane_branch_never_activates() {
        let cond = create_blocked_side_condition();
        // section 2 (position 250/100=2), outer lane (>3*horse_lane) -> rates 0.
        let outer = state(0, 250.0, 4.0, Strategy::FrontRunner);
        assert_eq!(cond.update(&outer, 0, &mut FixedRng(0.0)), 0);
    }

    #[test]
    fn overtake_uses_strategy_branch() {
        let cond = create_overtake_condition();
        assert_eq!(cond.value_on_start(), 0);

        // FrontRunner start_rate 0.05.
        let nige = state(0, 0.0, 0.0, Strategy::FrontRunner);
        assert_eq!(cond.update(&nige, 0, &mut FixedRng(0.04)), 1);
        assert_eq!(cond.update(&nige, 0, &mut FixedRng(0.06)), 0);

        // Fallback (LateSurger) start_rate 0.2.
        let other = state(0, 0.0, 0.0, Strategy::LateSurger);
        assert_eq!(cond.update(&other, 0, &mut FixedRng(0.1)), 1);
        assert_eq!(cond.update(&other, 0, &mut FixedRng(0.3)), 0);
    }
}
