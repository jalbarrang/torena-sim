//! Pacer-selection **domain service** (`select_pacer`).
//!
//! Port of `getPacer()` from `common/race.ts`. Extracted as its own domain
//! service so the `Race` aggregate stays focused on invariants. Selection is
//! pure (no mutation): the lucky-pace / virtual-pacemaker cases need the chosen
//! runner's `position_keep_strategy` promoted to Front Runner, which the caller
//! applies via [`PacerSelection::promote_to_front_runner`].

use crate::runner::Runner;
use crate::shared_kernel::ids::RunnerId;
use crate::shared_kernel::language::{strategy_matches, Strategy};

/// The outcome of pacer selection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PacerSelection {
    /// The chosen pacer.
    pub runner_id: RunnerId,
    /// Whether the chosen runner's `position_keep_strategy` must be promoted to
    /// Front Runner (lucky-pace / virtual-pacemaker fallbacks).
    pub promote_to_front_runner: bool,
}

/// Pick the furthest-forward runner whose `position_keep_strategy` exactly
/// equals `strategy`. Ties keep the earliest in iteration order.
fn furthest_with_exact_strategy(runners: &[Runner], strategy: Strategy) -> Option<&Runner> {
    furthest(runners, |r| r.position_keep_strategy == strategy)
}

/// Pick the furthest-forward runner whose `position_keep_strategy` matches
/// `strategy` (Runaway/Front Runner equivalence).
fn furthest_matching_strategy(runners: &[Runner], strategy: Strategy) -> Option<&Runner> {
    furthest(runners, |r| {
        strategy_matches(r.position_keep_strategy, strategy)
    })
}

/// Furthest-forward runner satisfying `predicate`; ties resolve to the earliest
/// in iteration order (matching the TS `reduce` with a strict `>`).
fn furthest(runners: &[Runner], predicate: impl Fn(&Runner) -> bool) -> Option<&Runner> {
    let mut best: Option<&Runner> = None;
    for runner in runners.iter().filter(|r| predicate(r)) {
        match best {
            Some(current) if runner.position > current.position => best = Some(runner),
            Some(_) => {}
            None => best = Some(runner),
        }
    }
    best
}

/// Select the pacer for the field, mirroring `getPacer()`.
///
/// Order of preference:
/// 1. Furthest Runaway, else furthest Front Runner (exact strategy).
/// 2. The existing pacer override, if any (no promotion).
/// 3. Lucky pace: furthest Pace Chaser, else Late Surger, else End Closer
///    (promoted to Front Runner).
/// 4. The existing pacer override as a virtual pacemaker (promoted).
pub fn select_pacer(
    runners: &[Runner],
    pacer_override: Option<RunnerId>,
) -> Option<PacerSelection> {
    for strategy in [Strategy::Runaway, Strategy::FrontRunner] {
        if let Some(runner) = furthest_with_exact_strategy(runners, strategy) {
            return Some(PacerSelection {
                runner_id: runner.id,
                promote_to_front_runner: false,
            });
        }
    }

    if let Some(runner_id) = pacer_override {
        return Some(PacerSelection {
            runner_id,
            promote_to_front_runner: false,
        });
    }

    for strategy in [
        Strategy::PaceChaser,
        Strategy::LateSurger,
        Strategy::EndCloser,
    ] {
        if let Some(runner) = furthest_matching_strategy(runners, strategy) {
            return Some(PacerSelection {
                runner_id: runner.id,
                promote_to_front_runner: true,
            });
        }
    }

    pacer_override.map(|runner_id| PacerSelection {
        runner_id,
        promote_to_front_runner: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runner::test_support::test_runner;

    fn runner(id: u32, strategy: Strategy, position: f64) -> Runner {
        let mut r = test_runner(id, strategy);
        r.position = position;
        r
    }

    #[test]
    fn prefers_furthest_runaway_then_front_runner() {
        let runners = vec![
            runner(0, Strategy::FrontRunner, 300.0),
            runner(1, Strategy::Runaway, 250.0),
            runner(2, Strategy::Runaway, 280.0),
        ];
        let sel = select_pacer(&runners, None).expect("pacer");
        // Runaway is preferred over Front Runner; furthest Runaway is id 2.
        assert_eq!(sel.runner_id, RunnerId(2));
        assert!(!sel.promote_to_front_runner);
    }

    #[test]
    fn falls_back_to_front_runner_when_no_runaway() {
        let runners = vec![
            runner(0, Strategy::FrontRunner, 200.0),
            runner(1, Strategy::FrontRunner, 260.0),
            runner(2, Strategy::PaceChaser, 300.0),
        ];
        let sel = select_pacer(&runners, None).expect("pacer");
        assert_eq!(sel.runner_id, RunnerId(1));
        assert!(!sel.promote_to_front_runner);
    }

    #[test]
    fn lucky_pace_promotes_to_front_runner() {
        let runners = vec![
            runner(0, Strategy::LateSurger, 200.0),
            runner(1, Strategy::PaceChaser, 180.0),
            runner(2, Strategy::PaceChaser, 220.0),
        ];
        let sel = select_pacer(&runners, None).expect("pacer");
        // Pace Chaser preferred over Late Surger; furthest is id 2; promoted.
        assert_eq!(sel.runner_id, RunnerId(2));
        assert!(sel.promote_to_front_runner);
    }

    #[test]
    fn override_used_before_lucky_pace() {
        let runners = vec![
            runner(0, Strategy::PaceChaser, 180.0),
            runner(1, Strategy::LateSurger, 220.0),
        ];
        let sel = select_pacer(&runners, Some(RunnerId(7))).expect("pacer");
        assert_eq!(sel.runner_id, RunnerId(7));
        assert!(!sel.promote_to_front_runner);
    }

    #[test]
    fn ties_keep_earliest_in_order() {
        let runners = vec![
            runner(0, Strategy::FrontRunner, 250.0),
            runner(1, Strategy::FrontRunner, 250.0),
        ];
        let sel = select_pacer(&runners, None).expect("pacer");
        assert_eq!(sel.runner_id, RunnerId(0));
    }

    #[test]
    fn empty_field_without_override_is_none() {
        assert_eq!(select_pacer(&[], None), None);
    }
}
