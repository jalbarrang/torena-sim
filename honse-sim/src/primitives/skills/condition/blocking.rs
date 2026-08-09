//! Full-sim blocking / overtake dynamic conditions.
//!
//! Port of `full-sim/blocking-conditions.ts`. Each predicate inspects the
//! observing runner plus the snapshots of every other active runner (read
//! through [`RunnerView`]) to decide whether the runner is blocked in front, to
//! the side, or actively overtaking.

use crate::skills::condition::dynamic::{
    bool_num, compare, register_dynamic_condition, DynamicCondition, RunnerView,
};

const FRONT_BLOCK_DISTANCE_METERS: f64 = 5.0;
const FRONT_BLOCK_LANE_MULTIPLIER: f64 = 1.0;
const SIDE_BLOCK_DISTANCE_METERS: f64 = 3.0;
const SIDE_BLOCK_LANE_MULTIPLIER: f64 = 1.0;
const OVERTAKE_DISTANCE_METERS: f64 = 5.0;
const OVERTAKE_LANE_MULTIPLIER: f64 = 2.0;
const MOVING_LANE_EPSILON: f64 = 0.00001;

fn lane_threshold(runner: &dyn RunnerView, multiplier: f64) -> f64 {
    runner.horse_lane() * multiplier
}

fn has_front_blocking_runner(runner: &dyn RunnerView) -> bool {
    let threshold = lane_threshold(runner, FRONT_BLOCK_LANE_MULTIPLIER);
    runner.other_snapshots().iter().any(|snapshot| {
        let distance_ahead = snapshot.position - runner.position();
        let lane_delta = (snapshot.current_lane - runner.current_lane()).abs();
        distance_ahead > 0.0
            && distance_ahead <= FRONT_BLOCK_DISTANCE_METERS
            && lane_delta <= threshold
    })
}

/// `(left_blocked, right_blocked)` — whether a runner sits within the side-block
/// window on each flank.
fn side_blocking_state(runner: &dyn RunnerView) -> (bool, bool) {
    let threshold = lane_threshold(runner, SIDE_BLOCK_LANE_MULTIPLIER);
    let mut left_blocked = false;
    let mut right_blocked = false;

    for snapshot in runner.other_snapshots() {
        let lane_delta = snapshot.current_lane - runner.current_lane();
        let distance_delta = (snapshot.position - runner.position()).abs();

        if lane_delta.abs() > threshold
            || lane_delta.abs() < MOVING_LANE_EPSILON
            || distance_delta > SIDE_BLOCK_DISTANCE_METERS
        {
            continue;
        }

        if lane_delta < 0.0 {
            left_blocked = true;
        } else {
            right_blocked = true;
        }
    }

    (left_blocked, right_blocked)
}

fn has_side_blocking_runner(runner: &dyn RunnerView) -> bool {
    let (left, right) = side_blocking_state(runner);
    left || right
}

fn has_all_side_blocking_runners(runner: &dyn RunnerView) -> bool {
    let (left, right) = side_blocking_state(runner);
    left && right
}

fn is_overtaking_runner(runner: &dyn RunnerView) -> bool {
    let threshold = lane_threshold(runner, OVERTAKE_LANE_MULTIPLIER);
    runner.other_snapshots().iter().any(|snapshot| {
        let is_faster = runner.current_speed() > snapshot.current_speed;
        let distance_gap = (snapshot.position - runner.position()).abs();
        let lane_delta = (snapshot.current_lane - runner.current_lane()).abs();
        is_faster && distance_gap <= OVERTAKE_DISTANCE_METERS && lane_delta <= threshold
    })
}

/// The "continuous time" proxy: while `predicate` holds, the runner's elapsed
/// race time is compared against `arg`; otherwise zero is compared.
fn continuous_time(runner: &dyn RunnerView, active: bool) -> f64 {
    if active {
        runner.accumulate_time()
    } else {
        0.0
    }
}

/// Register every blocking / overtake dynamic condition.
pub fn register_blocking_conditions() {
    register_dynamic_condition("blocked_front", |arg, cmp| {
        DynamicCondition::new(move |r| {
            compare(bool_num(has_front_blocking_runner(r)), arg as f64, cmp)
        })
    });

    register_dynamic_condition("blocked_front_continuetime", |arg, cmp| {
        DynamicCondition::new(move |r| {
            compare(
                continuous_time(r, has_front_blocking_runner(r)),
                arg as f64,
                cmp,
            )
        })
    });

    register_dynamic_condition("blocked_all_continuetime", |arg, cmp| {
        DynamicCondition::new(move |r| {
            let active = has_front_blocking_runner(r) && has_all_side_blocking_runners(r);
            compare(continuous_time(r, active), arg as f64, cmp)
        })
    });

    register_dynamic_condition("blocked_side_continuetime", |arg, cmp| {
        DynamicCondition::new(move |r| {
            compare(
                continuous_time(r, has_side_blocking_runner(r)),
                arg as f64,
                cmp,
            )
        })
    });

    register_dynamic_condition("is_overtake", |arg, cmp| {
        DynamicCondition::new(move |r| compare(bool_num(is_overtaking_runner(r)), arg as f64, cmp))
    });

    register_dynamic_condition("is_move_lane", |arg, cmp| {
        DynamicCondition::new(move |r| {
            let is_moving_lane = r.lane_change_speed().abs() > MOVING_LANE_EPSILON;
            compare(bool_num(is_moving_lane), arg as f64, cmp)
        })
    });

    register_dynamic_condition("overtake_target_time", |arg, cmp| {
        DynamicCondition::new(move |r| {
            compare(continuous_time(r, is_overtaking_runner(r)), arg as f64, cmp)
        })
    });

    register_dynamic_condition("overtake_target_no_order_up_time", |arg, cmp| {
        DynamicCondition::new(move |r| {
            compare(continuous_time(r, is_overtaking_runner(r)), arg as f64, cmp)
        })
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared_kernel::language::Strategy;
    use crate::skills::condition::dynamic::{
        get_dynamic_condition, register_all_dynamic_conditions, ActiveRunner, RunnerSnapshot,
    };
    use crate::skills::condition::operator::CmpKind;

    #[derive(Default)]
    struct TestRunner {
        position: f64,
        current_lane: f64,
        current_speed: f64,
        lane_change_speed: f64,
        accumulate_time: f64,
        snapshots: Vec<RunnerSnapshot>,
    }

    impl RunnerView for TestRunner {
        fn position(&self) -> f64 {
            self.position
        }
        fn current_lane(&self) -> f64 {
            self.current_lane
        }
        fn current_speed(&self) -> f64 {
            self.current_speed
        }
        fn lane_change_speed(&self) -> f64 {
            self.lane_change_speed
        }
        fn horse_lane(&self) -> f64 {
            1.0
        }
        fn accumulate_time(&self) -> f64 {
            self.accumulate_time
        }
        fn other_snapshots(&self) -> Vec<RunnerSnapshot> {
            self.snapshots.clone()
        }
        fn active_runners(&self) -> Vec<ActiveRunner> {
            vec![ActiveRunner {
                is_self: true,
                position: self.position,
                strategy: Strategy::FrontRunner,
                gate: 0,
                is_rushed: false,
                is_dueling: false,
                activated_advantage_effect_types: 0,
            }]
        }
    }

    fn snap(position: f64, lane: f64, speed: f64) -> RunnerSnapshot {
        RunnerSnapshot {
            position,
            current_lane: lane,
            current_speed: speed,
        }
    }

    #[test]
    fn front_block_detects_close_runner_ahead_in_lane() {
        register_blocking_conditions();
        let factory = get_dynamic_condition("blocked_front").expect("registered");
        let cond = factory(1, CmpKind::Eq);

        let blocked = TestRunner {
            position: 100.0,
            snapshots: vec![snap(103.0, 0.0, 0.0)],
            ..Default::default()
        };
        assert!(cond.eval(&blocked));

        let too_far = TestRunner {
            position: 100.0,
            snapshots: vec![snap(110.0, 0.0, 0.0)],
            ..Default::default()
        };
        assert!(!cond.eval(&too_far));

        let off_lane = TestRunner {
            position: 100.0,
            snapshots: vec![snap(103.0, 5.0, 0.0)],
            ..Default::default()
        };
        assert!(!cond.eval(&off_lane));
    }

    #[test]
    fn blocked_side_continuetime_uses_elapsed_time_when_blocked() {
        register_blocking_conditions();
        let factory = get_dynamic_condition("blocked_side_continuetime").expect("registered");
        let cond = factory(2, CmpKind::Gte);

        let blocked = TestRunner {
            position: 100.0,
            current_lane: 1.0,
            accumulate_time: 9.0,
            snapshots: vec![snap(101.0, 0.5, 0.0)],
            ..Default::default()
        };
        assert!(cond.eval(&blocked));

        let unblocked = TestRunner {
            position: 100.0,
            accumulate_time: 9.0,
            snapshots: vec![],
            ..Default::default()
        };
        assert!(!cond.eval(&unblocked));
    }

    #[test]
    fn overtake_requires_faster_speed_and_proximity() {
        register_blocking_conditions();
        let factory = get_dynamic_condition("is_overtake").expect("registered");
        let cond = factory(1, CmpKind::Eq);

        let overtaking = TestRunner {
            position: 100.0,
            current_speed: 20.0,
            snapshots: vec![snap(103.0, 0.0, 18.0)],
            ..Default::default()
        };
        assert!(cond.eval(&overtaking));

        let slower = TestRunner {
            position: 100.0,
            current_speed: 15.0,
            snapshots: vec![snap(103.0, 0.0, 18.0)],
            ..Default::default()
        };
        assert!(!cond.eval(&slower));
    }

    #[test]
    fn is_move_lane_tracks_lane_change_speed() {
        register_blocking_conditions();
        let factory = get_dynamic_condition("is_move_lane").expect("registered");
        let cond = factory(1, CmpKind::Eq);

        let moving = TestRunner {
            lane_change_speed: 0.5,
            ..Default::default()
        };
        assert!(cond.eval(&moving));

        let still = TestRunner::default();
        assert!(!cond.eval(&still));
    }

    #[test]
    fn register_all_populates_blocking() {
        register_all_dynamic_conditions();
        assert!(get_dynamic_condition("blocked_front").is_some());
        assert!(get_dynamic_condition("overtake_target_time").is_some());
    }
}
