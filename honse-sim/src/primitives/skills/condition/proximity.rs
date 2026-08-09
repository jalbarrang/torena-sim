//! Full-sim proximity dynamic conditions.
//!
//! Port of `full-sim/proximity-conditions.ts`. These count or detect nearby
//! runners (ahead, behind, in adjacent lanes) using the snapshots exposed by
//! [`RunnerView`].

use crate::skills::condition::dynamic::{
    bool_num, compare, register_dynamic_condition, DynamicCondition, RunnerSnapshot, RunnerView,
};

const NEAR_DISTANCE_METERS: f64 = 3.0;
const BASHIN_METERS: f64 = 2.5;
const NEAR_COUNT_LANE_MULTIPLIER: f64 = 3.0;
const SURROUNDED_LANE_MULTIPLIER: f64 = 1.0;
const NEAR_LANE_TIME_LANE_MULTIPLIER: f64 = 1.0;
const VISIBLE_DISTANCE_METERS: f64 = 20.0;
const VISIBLE_LANE_MULTIPLIER: f64 = 11.5;

/// Which side relative to the observing runner a predicate considers.
#[derive(Clone, Copy)]
enum Direction {
    Behind,
    Infront,
}

fn lane_threshold(runner: &dyn RunnerView, multiplier: f64) -> f64 {
    runner.horse_lane() * multiplier
}

fn within_distance(runner: &dyn RunnerView, other: &RunnerSnapshot, max_distance: f64) -> bool {
    (other.position - runner.position()).abs() <= max_distance
}

fn within_lane(runner: &dyn RunnerView, other: &RunnerSnapshot, lane_threshold: f64) -> bool {
    (other.current_lane - runner.current_lane()).abs() <= lane_threshold
}

fn is_ahead_of(runner: &dyn RunnerView, other: &RunnerSnapshot) -> bool {
    other.position > runner.position()
}

fn is_behind_of(runner: &dyn RunnerView, other: &RunnerSnapshot) -> bool {
    other.position < runner.position()
}

fn nearest_runner_behind(runner: &dyn RunnerView) -> Option<RunnerSnapshot> {
    let mut nearest: Option<RunnerSnapshot> = None;
    let mut nearest_distance = f64::INFINITY;
    for snapshot in runner.other_snapshots() {
        if !is_behind_of(runner, &snapshot) {
            continue;
        }
        let distance = runner.position() - snapshot.position;
        if distance < nearest_distance {
            nearest_distance = distance;
            nearest = Some(snapshot);
        }
    }
    nearest
}

fn nearest_runner_infront(runner: &dyn RunnerView) -> Option<RunnerSnapshot> {
    let mut nearest: Option<RunnerSnapshot> = None;
    let mut nearest_distance = f64::INFINITY;
    for snapshot in runner.other_snapshots() {
        if !is_ahead_of(runner, &snapshot) {
            continue;
        }
        let distance = snapshot.position - runner.position();
        if distance < nearest_distance {
            nearest_distance = distance;
            nearest = Some(snapshot);
        }
    }
    nearest
}

fn has_near_lane_runner(runner: &dyn RunnerView, direction: Direction) -> bool {
    let threshold = lane_threshold(runner, NEAR_LANE_TIME_LANE_MULTIPLIER);
    runner.other_snapshots().iter().any(|snapshot| {
        let in_direction = match direction {
            Direction::Behind => is_behind_of(runner, snapshot),
            Direction::Infront => is_ahead_of(runner, snapshot),
        };
        in_direction
            && within_distance(runner, snapshot, NEAR_DISTANCE_METERS)
            && within_lane(runner, snapshot, threshold)
    })
}

fn near_lane_time(runner: &dyn RunnerView, direction: Direction) -> f64 {
    if has_near_lane_runner(runner, direction) {
        runner.accumulate_time()
    } else {
        0.0
    }
}

/// Register every proximity dynamic condition.
pub fn register_proximity_conditions() {
    register_dynamic_condition("near_count", |arg, cmp| {
        DynamicCondition::new(move |r| {
            let threshold = lane_threshold(r, NEAR_COUNT_LANE_MULTIPLIER);
            let count = r
                .other_snapshots()
                .iter()
                .filter(|s| {
                    within_distance(r, s, NEAR_DISTANCE_METERS) && within_lane(r, s, threshold)
                })
                .count();
            compare(count as f64, arg as f64, cmp)
        })
    });

    // Runners close in front of the observer (near_count filtered to ahead).
    register_dynamic_condition("near_infront_count", |arg, cmp| {
        DynamicCondition::new(move |r| {
            let threshold = lane_threshold(r, NEAR_COUNT_LANE_MULTIPLIER);
            let position = r.position();
            let count = r
                .other_snapshots()
                .iter()
                .filter(|s| {
                    s.position > position
                        && within_distance(r, s, NEAR_DISTANCE_METERS)
                        && within_lane(r, s, threshold)
                })
                .count();
            compare(count as f64, arg as f64, cmp)
        })
    });

    register_dynamic_condition("is_surrounded", |arg, cmp| {
        DynamicCondition::new(move |r| {
            let threshold = lane_threshold(r, SURROUNDED_LANE_MULTIPLIER);
            let mut ahead = false;
            let mut behind = false;
            for snapshot in r.other_snapshots() {
                if !within_distance(r, &snapshot, NEAR_DISTANCE_METERS)
                    || !within_lane(r, &snapshot, threshold)
                {
                    continue;
                }
                if is_ahead_of(r, &snapshot) {
                    ahead = true;
                } else if is_behind_of(r, &snapshot) {
                    behind = true;
                }
            }
            compare(bool_num(ahead && behind), arg as f64, cmp)
        })
    });

    register_dynamic_condition("bashin_diff_behind", |arg, cmp| {
        DynamicCondition::new(move |r| match nearest_runner_behind(r) {
            Some(nearest) => {
                let bashin_diff = (r.position() - nearest.position) / BASHIN_METERS;
                compare(bashin_diff, arg as f64, cmp)
            }
            None => false,
        })
    });

    register_dynamic_condition("bashin_diff_infront", |arg, cmp| {
        DynamicCondition::new(move |r| match nearest_runner_infront(r) {
            Some(nearest) => {
                let bashin_diff = (nearest.position - r.position()) / BASHIN_METERS;
                compare(bashin_diff, arg as f64, cmp)
            }
            None => false,
        })
    });

    register_dynamic_condition("behind_near_lane_time", |arg, cmp| {
        DynamicCondition::new(move |r| {
            compare(near_lane_time(r, Direction::Behind), arg as f64, cmp)
        })
    });
    register_dynamic_condition("behind_near_lane_time_set1", |arg, cmp| {
        DynamicCondition::new(move |r| {
            compare(near_lane_time(r, Direction::Behind), arg as f64, cmp)
        })
    });
    register_dynamic_condition("infront_near_lane_time", |arg, cmp| {
        DynamicCondition::new(move |r| {
            compare(near_lane_time(r, Direction::Infront), arg as f64, cmp)
        })
    });

    register_dynamic_condition("visiblehorse", |arg, cmp| {
        DynamicCondition::new(move |r| {
            let threshold = lane_threshold(r, VISIBLE_LANE_MULTIPLIER);
            let count = r
                .other_snapshots()
                .iter()
                .filter(|s| {
                    let longitudinal = s.position - r.position();
                    (0.0..=VISIBLE_DISTANCE_METERS).contains(&longitudinal)
                        && within_lane(r, s, threshold)
                })
                .count();
            compare(count as f64, arg as f64, cmp)
        })
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::skills::condition::dynamic::get_dynamic_condition;
    use crate::skills::condition::operator::CmpKind;

    #[derive(Default)]
    struct TestRunner {
        position: f64,
        current_lane: f64,
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
        fn horse_lane(&self) -> f64 {
            1.0
        }
        fn accumulate_time(&self) -> f64 {
            self.accumulate_time
        }
        fn other_snapshots(&self) -> Vec<RunnerSnapshot> {
            self.snapshots.clone()
        }
    }

    fn snap(position: f64, lane: f64) -> RunnerSnapshot {
        RunnerSnapshot {
            position,
            current_lane: lane,
            current_speed: 0.0,
        }
    }

    #[test]
    fn near_count_counts_runners_within_window() {
        register_proximity_conditions();
        let factory = get_dynamic_condition("near_count").expect("registered");
        let cond = factory(2, CmpKind::Gte);

        let crowded = TestRunner {
            position: 100.0,
            snapshots: vec![snap(101.0, 0.0), snap(99.0, 1.0), snap(120.0, 0.0)],
            ..Default::default()
        };
        assert!(cond.eval(&crowded)); // two within 3m & lane window

        let sparse = TestRunner {
            position: 100.0,
            snapshots: vec![snap(101.0, 0.0)],
            ..Default::default()
        };
        assert!(!cond.eval(&sparse));
    }

    #[test]
    fn is_surrounded_requires_both_sides() {
        register_proximity_conditions();
        let factory = get_dynamic_condition("is_surrounded").expect("registered");
        let cond = factory(1, CmpKind::Eq);

        let surrounded = TestRunner {
            position: 100.0,
            snapshots: vec![snap(102.0, 0.0), snap(98.0, 0.0)],
            ..Default::default()
        };
        assert!(cond.eval(&surrounded));

        let only_ahead = TestRunner {
            position: 100.0,
            snapshots: vec![snap(102.0, 0.0)],
            ..Default::default()
        };
        assert!(!cond.eval(&only_ahead));
    }

    #[test]
    fn bashin_diff_infront_uses_nearest_runner() {
        register_proximity_conditions();
        let factory = get_dynamic_condition("bashin_diff_infront").expect("registered");
        let cond = factory(1, CmpKind::Lte);

        // nearest infront is 2m ahead -> 2/2.5 = 0.8 <= 1
        let runner = TestRunner {
            position: 100.0,
            snapshots: vec![snap(102.0, 0.0), snap(110.0, 0.0)],
            ..Default::default()
        };
        assert!(cond.eval(&runner));

        let none_infront = TestRunner {
            position: 100.0,
            snapshots: vec![snap(98.0, 0.0)],
            ..Default::default()
        };
        assert!(!cond.eval(&none_infront));
    }

    #[test]
    fn infront_near_lane_time_uses_elapsed_time() {
        register_proximity_conditions();
        let factory = get_dynamic_condition("infront_near_lane_time").expect("registered");
        let cond = factory(1, CmpKind::Gte);

        let near = TestRunner {
            position: 100.0,
            accumulate_time: 3.0,
            snapshots: vec![snap(102.0, 0.0)],
            ..Default::default()
        };
        assert!(cond.eval(&near));

        let far = TestRunner {
            position: 100.0,
            accumulate_time: 3.0,
            snapshots: vec![snap(102.0, 5.0)],
            ..Default::default()
        };
        assert!(!cond.eval(&far));
    }
}
