//! Full-sim order / position dynamic conditions.
//!
//! Port of `full-sim/order-conditions.ts`. These read the runner's current and
//! previous finishing order, the field size, and the leader's position (all
//! through [`RunnerView`]) to gate order-relative skills.

use crate::skills::condition::dynamic::{
    bool_num, compare, register_dynamic_condition, DynamicCondition, RunnerView,
};

use crate::skills::condition::operator::CmpKind;

const CONTINUE_GRACE_PERIOD_SECONDS: f64 = 5.0;

fn order_rate_continue(
    runner: &dyn RunnerView,
    rate: f64,
    is_in_rate: bool,
    arg: i64,
    cmp: CmpKind,
) -> bool {
    let Some(order) = runner.current_order() else {
        return false;
    };
    let threshold = (runner.num_umas() as f64 * rate).round() as i64;
    let within_rate = if is_in_rate {
        order <= threshold
    } else {
        order > threshold
    };
    let active = runner.accumulate_time() > CONTINUE_GRACE_PERIOD_SECONDS && within_rate;
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
            let distance = r.course_distance();
            if distance == 0.0 {
                return false;
            }
            let rate = ((leader - r.position()) / distance) * 100.0;
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
        leader_position: Option<f64>,
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
        fn leader_position(&self) -> Option<f64> {
            self.leader_position
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

        // 12 runners, threshold = round(12*0.5)=6; order 3 <= 6 and time > 5s -> active.
        let active = TestRunner {
            num_umas: 12,
            current_order: Some(3),
            accumulate_time: 6.0,
            ..Default::default()
        };
        assert!(cond.eval(&active));

        // Same position but before the grace period -> inactive.
        let too_early = TestRunner {
            num_umas: 12,
            current_order: Some(3),
            accumulate_time: 4.0,
            ..Default::default()
        };
        assert!(!cond.eval(&too_early));
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
}
