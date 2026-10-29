//! Full-sim order / position dynamic conditions.
//!
//! Port of `full-sim/order-conditions.ts`. These read the runner's current and
//! previous finishing order, the field size, and the leader's position (all
//! through [`RunnerView`]) to gate order-relative skills.

use crate::skills::condition::dynamic::{
    bool_num, compare, register_dynamic_condition, DynamicCondition, RunnerView,
};

use crate::skills::condition::operator::CmpKind;

/// The `*_continue` order conditions ignore the opening seconds of the race, so
/// the field has time to spread out before a position band starts counting.
///
/// Shared with the runners, which start folding their order into the band
/// history once this much race time has elapsed.
pub const CONTINUE_GRACE_PERIOD_SECONDS: f64 = 5.0;

/// `order_rate_inXX_continue` / `order_rate_outXX_continue`: the band must have
/// held since the grace period, not merely at the activating tick.
///
/// The runner folds its per-tick order into min/max history
/// ([`Runner::observe_order_history`](crate::runner::Runner::observe_order_history)),
/// so `in` asks whether the *worst* order recorded still sat inside the band and
/// `out` whether the *best* one still sat outside it.
fn order_rate_continue(
    runner: &dyn RunnerView,
    rate: f64,
    is_in_rate: bool,
    arg: i64,
    cmp: CmpKind,
) -> bool {
    let threshold = (runner.num_umas() as f64 * rate).round() as i64;
    let held = if is_in_rate {
        runner
            .order_max_since_grace()
            .is_some_and(|worst| worst <= threshold)
    } else {
        runner
            .order_min_since_grace()
            .is_some_and(|best| best > threshold)
    };
    let active = runner.accumulate_time() > CONTINUE_GRACE_PERIOD_SECONDS && held;
    compare(bool_num(active), arg as f64, cmp)
}

fn change_order_up(runner: &dyn RunnerView, arg: i64, cmp: CmpKind) -> bool {
    let (Some(previous), Some(current)) = (runner.previous_order(), runner.current_order()) else {
        return false;
    };
    let improved = current < previous;
    compare(bool_num(improved), arg as f64, cmp)
}

/// Register every order / position dynamic condition.
pub fn register_order_conditions() {
    register_dynamic_condition("order", |arg, cmp| {
        DynamicCondition::new(move |r| match r.current_order() {
            Some(order) => compare(order as f64, arg as f64, cmp),
            None => false,
        })
    });

    register_dynamic_condition("order_rate", |arg, cmp| {
        DynamicCondition::new(move |r| {
            let Some(order) = r.current_order() else {
                return false;
            };
            let order_as_position = (r.num_umas() as f64 * (arg as f64 / 100.0)).round();
            compare(order as f64, order_as_position, cmp)
        })
    });

    register_dynamic_condition("order_rate_in20_continue", |arg, cmp| {
        DynamicCondition::new(move |r| order_rate_continue(r, 0.2, true, arg, cmp))
    });
    register_dynamic_condition("order_rate_in40_continue", |arg, cmp| {
        DynamicCondition::new(move |r| order_rate_continue(r, 0.4, true, arg, cmp))
    });
    register_dynamic_condition("order_rate_in50_continue", |arg, cmp| {
        DynamicCondition::new(move |r| order_rate_continue(r, 0.5, true, arg, cmp))
    });
    register_dynamic_condition("order_rate_in80_continue", |arg, cmp| {
        DynamicCondition::new(move |r| order_rate_continue(r, 0.8, true, arg, cmp))
    });

    register_dynamic_condition("order_rate_out20_continue", |arg, cmp| {
        DynamicCondition::new(move |r| order_rate_continue(r, 0.2, false, arg, cmp))
    });
    register_dynamic_condition("order_rate_out40_continue", |arg, cmp| {
        DynamicCondition::new(move |r| order_rate_continue(r, 0.4, false, arg, cmp))
    });
    register_dynamic_condition("order_rate_out50_continue", |arg, cmp| {
        DynamicCondition::new(move |r| order_rate_continue(r, 0.5, false, arg, cmp))
    });
    register_dynamic_condition("order_rate_out70_continue", |arg, cmp| {
        DynamicCondition::new(move |r| order_rate_continue(r, 0.7, false, arg, cmp))
    });

    register_dynamic_condition("change_order_onetime", |arg, cmp| {
        DynamicCondition::new(move |r| {
            let (Some(previous), Some(current)) = (r.previous_order(), r.current_order()) else {
                return false;
            };
            let order_delta = current - previous;
            compare(order_delta as f64, arg as f64, cmp)
        })
    });

    register_dynamic_condition("change_order_up_end_after", |arg, cmp| {
        DynamicCondition::new(move |r| change_order_up(r, arg, cmp))
    });
    register_dynamic_condition("change_order_up_finalcorner_after", |arg, cmp| {
        DynamicCondition::new(move |r| change_order_up(r, arg, cmp))
    });
    register_dynamic_condition("change_order_up_middle", |arg, cmp| {
        DynamicCondition::new(move |r| change_order_up(r, arg, cmp))
    });

    register_dynamic_condition("distance_diff_top", |arg, cmp| {
        DynamicCondition::new(move |r| {
            let Some(leader) = r.leader_position() else {
                return false;
            };
            let diff_meters = (leader - r.position()).max(0.0);
            compare(diff_meters.floor(), arg as f64, cmp)
        })
    });

    register_dynamic_condition("distance_diff_top_float", |arg, cmp| {
        DynamicCondition::new(move |r| {
            let Some(leader) = r.leader_position() else {
                return false;
            };
            let diff_decimeters = ((leader - r.position()) * 10.0).max(0.0);
            compare(diff_decimeters, arg as f64, cmp)
        })
    });

    register_dynamic_condition("distance_diff_rate", |arg, cmp| {
        DynamicCondition::new(move |r| {
            let Some(leader) = r.leader_position() else {
                return false;
            };
            // Rate is the runner's place *inside the field's spread*: 0 at the
            // leader, 100 at the last runner. Normalising against the course
            // length instead would trap every value near zero — the whole field
            // spans tens of meters — which left the `<=` conditions always true
            // and the `>=` ones unreachable (e.g. Defeatist, Sleeping Lion).
            let Some(last) = r.last_position() else {
                return false;
            };
            let spread = leader - last;
            if spread <= 0.0 {
                // Field level with the leader (gate, or a single active runner):
                // there is no band to express a position in.
                return false;
            }
            let rate = ((leader - r.position()) / spread) * 100.0;
            compare(rate, arg as f64, cmp)
        })
    });

    register_dynamic_condition("is_behind_in", |arg, cmp| {
        DynamicCondition::new(move |r| match r.current_order() {
            Some(order) => compare(order as f64, arg as f64, cmp),
            None => false,
        })
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::skills::condition::dynamic::get_dynamic_condition;

    #[derive(Default)]
    struct TestRunner {
        position: f64,
        course_distance: f64,
        accumulate_time: f64,
        num_umas: i64,
        current_order: Option<i64>,
        previous_order: Option<i64>,
        order_min_since_grace: Option<i64>,
        order_max_since_grace: Option<i64>,
        leader_position: Option<f64>,
        last_position: Option<f64>,
    }

    impl RunnerView for TestRunner {
        fn position(&self) -> f64 {
            self.position
        }
        fn course_distance(&self) -> f64 {
            self.course_distance
        }
        fn accumulate_time(&self) -> f64 {
            self.accumulate_time
        }
        fn num_umas(&self) -> i64 {
            self.num_umas
        }
        fn current_order(&self) -> Option<i64> {
            self.current_order
        }
        fn previous_order(&self) -> Option<i64> {
            self.previous_order
        }
        fn order_min_since_grace(&self) -> Option<i64> {
            self.order_min_since_grace
        }
        fn order_max_since_grace(&self) -> Option<i64> {
            self.order_max_since_grace
        }
        fn leader_position(&self) -> Option<f64> {
            self.leader_position
        }
        fn last_position(&self) -> Option<f64> {
            self.last_position
        }
    }

    #[test]
    fn order_compares_current_order() {
        register_order_conditions();
        let factory = get_dynamic_condition("order").expect("registered");
        let cond = factory(3, CmpKind::Lte);

        let third = TestRunner {
            current_order: Some(3),
            ..Default::default()
        };
        assert!(cond.eval(&third));

        let fourth = TestRunner {
            current_order: Some(4),
            ..Default::default()
        };
        assert!(!cond.eval(&fourth));

        let unknown = TestRunner::default();
        assert!(!cond.eval(&unknown));
    }

    #[test]
    fn order_rate_in_continue_respects_grace_period() {
        register_order_conditions();
        let factory = get_dynamic_condition("order_rate_in50_continue").expect("registered");
        let cond = factory(1, CmpKind::Eq);

        // 12 runners, threshold = round(12*0.5)=6; worst held order 3 <= 6 and
        // time > 5s -> active.
        let active = TestRunner {
            num_umas: 12,
            order_min_since_grace: Some(3),
            order_max_since_grace: Some(3),
            accumulate_time: 6.0,
            ..Default::default()
        };
        assert!(cond.eval(&active));

        // Same history but before the grace period -> inactive.
        let too_early = TestRunner {
            num_umas: 12,
            order_min_since_grace: Some(3),
            order_max_since_grace: Some(3),
            accumulate_time: 4.0,
            ..Default::default()
        };
        assert!(!cond.eval(&too_early));
    }

    #[test]
    fn order_rate_in_continue_rejects_a_band_that_was_broken() {
        register_order_conditions();
        let factory = get_dynamic_condition("order_rate_in50_continue").expect("registered");
        let cond = factory(1, CmpKind::Eq);

        // Currently 3rd, but the runner already fell to 9th earlier: the band
        // did not hold, so the condition must not fire (the old current-order
        // check passed here).
        let broken = TestRunner {
            num_umas: 12,
            current_order: Some(3),
            order_min_since_grace: Some(3),
            order_max_since_grace: Some(9),
            accumulate_time: 40.0,
            ..Default::default()
        };
        assert!(!cond.eval(&broken));
    }

    #[test]
    fn order_rate_out_continue_rejects_a_band_that_was_broken() {
        register_order_conditions();
        let factory = get_dynamic_condition("order_rate_out50_continue").expect("registered");
        let cond = factory(1, CmpKind::Eq);

        // 12 runners, threshold = 6 -> outside means order > 6. Currently 9th,
        // but the runner was 2nd earlier, so it did enter the band.
        let broken = TestRunner {
            num_umas: 12,
            current_order: Some(9),
            order_min_since_grace: Some(2),
            order_max_since_grace: Some(9),
            accumulate_time: 40.0,
            ..Default::default()
        };
        assert!(!cond.eval(&broken));

        // Never left the back half -> active.
        let held = TestRunner {
            num_umas: 12,
            current_order: Some(9),
            order_min_since_grace: Some(7),
            order_max_since_grace: Some(9),
            accumulate_time: 40.0,
            ..Default::default()
        };
        assert!(cond.eval(&held));
    }

    #[test]
    fn order_rate_continue_needs_history_to_activate() {
        register_order_conditions();
        let factory = get_dynamic_condition("order_rate_out50_continue").expect("registered");
        let cond = factory(1, CmpKind::Eq);

        // Past the grace period but no history recorded (e.g. a view that only
        // reports the current order): nothing has been proven to hold yet.
        let no_history = TestRunner {
            num_umas: 12,
            current_order: Some(9),
            accumulate_time: 40.0,
            ..Default::default()
        };
        assert!(!cond.eval(&no_history));
    }

    #[test]
    fn change_order_up_detects_improvement() {
        register_order_conditions();
        let factory = get_dynamic_condition("change_order_up_middle").expect("registered");
        let cond = factory(1, CmpKind::Eq);

        let improved = TestRunner {
            previous_order: Some(5),
            current_order: Some(3),
            ..Default::default()
        };
        assert!(cond.eval(&improved));

        let dropped = TestRunner {
            previous_order: Some(3),
            current_order: Some(5),
            ..Default::default()
        };
        assert!(!cond.eval(&dropped));
    }

    #[test]
    fn distance_diff_top_floors_meters() {
        register_order_conditions();
        let factory = get_dynamic_condition("distance_diff_top").expect("registered");
        let cond = factory(5, CmpKind::Gte);

        let behind = TestRunner {
            position: 100.0,
            leader_position: Some(106.7),
            ..Default::default()
        };
        assert!(cond.eval(&behind)); // floor(6.7) = 6 >= 5

        let close = TestRunner {
            position: 100.0,
            leader_position: Some(103.0),
            ..Default::default()
        };
        assert!(!cond.eval(&close)); // floor(3) = 3 < 5
    }

    /// `distance_diff_rate` is a position *inside the field spread*: 0 at the
    /// leader, 100 at the last runner. Every case below uses a 40 m spread, so
    /// the thresholds line up with the game's own skill text ("toward the
    /// front" = low, "very back" = high).
    fn diff_rate_runner(position: f64) -> TestRunner {
        TestRunner {
            position,
            leader_position: Some(1000.0),
            last_position: Some(960.0),
            ..Default::default()
        }
    }

    #[test]
    fn distance_diff_rate_measures_position_inside_the_field_spread() {
        register_order_conditions();

        // 4 m behind the leader out of a 40 m spread = 10%.
        let near_lead = diff_rate_runner(996.0);
        let le10 =
            get_dynamic_condition("distance_diff_rate").expect("registered")(10, CmpKind::Lte);
        assert!(le10.eval(&near_lead));

        // 10 m behind = 25%.
        let mid_front = diff_rate_runner(990.0);
        let le10 =
            get_dynamic_condition("distance_diff_rate").expect("registered")(10, CmpKind::Lte);
        assert!(!le10.eval(&mid_front));
        let le30 =
            get_dynamic_condition("distance_diff_rate").expect("registered")(30, CmpKind::Lte);
        assert!(le30.eval(&mid_front));

        // 30 m behind out of 40 = 75% — the "very back" band Defeatist and
        // Sleeping Lion ask for, which the old course-length formula could never
        // reach.
        let very_back = diff_rate_runner(970.0);
        let ge75 =
            get_dynamic_condition("distance_diff_rate").expect("registered")(75, CmpKind::Gte);
        assert!(ge75.eval(&very_back));
        assert!(!le30.eval(&very_back));

        // The last runner is exactly 100%.
        let last = diff_rate_runner(960.0);
        let ge75 =
            get_dynamic_condition("distance_diff_rate").expect("registered")(75, CmpKind::Gte);
        assert!(ge75.eval(&last));
        let le10 =
            get_dynamic_condition("distance_diff_rate").expect("registered")(10, CmpKind::Lte);
        assert!(!le10.eval(&last));
    }

    #[test]
    fn distance_diff_rate_needs_a_spread() {
        register_order_conditions();
        let cond =
            get_dynamic_condition("distance_diff_rate").expect("registered")(10, CmpKind::Lte);

        // Field level with the leader: no band exists, so nothing is satisfied.
        let level = TestRunner {
            position: 1000.0,
            leader_position: Some(1000.0),
            last_position: Some(1000.0),
            ..Default::default()
        };
        assert!(!cond.eval(&level));

        // No field at all (gate view).
        let gate = TestRunner {
            position: 0.0,
            ..Default::default()
        };
        assert!(!cond.eval(&gate));
    }
}
