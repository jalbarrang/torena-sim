//! Target lane selection over a live field (mechanics § Target Lane, § Vision,
//! § Overlapping).
//!
//! Pure functions over the runner's own lane state and the frozen snapshots of
//! the other runners. The step calls [`resolve_target_lane`] once per tick when
//! a live field is present; the synthetic engine keeps its approximation.
//!
//! Two numbers the doc leaves open are fixed here and named as assumptions:
//! the longitudinal reach for the "inside uma" of normal-mode rule 5, taken as
//! the crowd distance (3 m), and the pace-down target lane 0.18, read as meters.

use crate::runner::physics::RunnerSnapshot;
use crate::shared_kernel::ids::RunnerId;

/// How far ahead a runner can see, in meters, before skills.
pub const VISIBLE_DISTANCE: f64 = 20.0;
/// Runners this close along the course and across it belong to one crowd.
const CROWD_DISTANCE: f64 = 3.0;
/// A candidate lane is free when no visible runner sits this many horse lanes
/// of it, either side.
const CANDIDATE_HALF_WIDTH_LANES: f64 = 0.8;
/// Side blocking reach along the course (mechanics § Side Blocking).
const SIDE_BLOCK_DISTANCE: f64 = 1.05;
/// Normal-mode rule 2: the lane a pace-down runner steers to, in meters.
const PACE_DOWN_LANE: f64 = 0.18;
/// Normal-mode rule 4: the inward drift per update in early and mid race.
const INWARD_DRIFT: f64 = 0.05;
/// Seconds overtake mode lingers after its last target is lost.
pub const OVERTAKE_LINGER_SECONDS: f64 = 1.5;
/// Overlap bump, in horse lanes (mechanics § Overlapping).
const OVERLAP_BUMP_LANES: f64 = 0.4;

/// The runner's own state the lane rules read.
#[derive(Debug, Clone, Copy)]
pub struct LaneSelf {
    /// Own id, so the field can be read without self.
    pub id: RunnerId,
    /// Meters along the course.
    pub position: f64,
    /// Meters from the inner rail.
    pub current_lane: f64,
    /// Current speed, m/s.
    pub current_speed: f64,
    /// Target speed, m/s.
    pub target_speed: f64,
    /// 0 early, 1 mid, 2 late, 3 last spurt.
    pub phase_index: usize,
    /// The final-corner lane, or a negative value before it is armed.
    pub extra_move_lane: f64,
    /// Whether the runner is out of HP.
    pub out_of_hp: bool,
    /// Whether position keeping is in pace-down.
    pub pace_down: bool,
    /// Whether the runner is on the final straight.
    pub on_final_straight: bool,
    /// The runner blocking in front this tick, if any.
    pub front_blocker: Option<RunnerId>,
}

/// Course constants the lane rules read.
#[derive(Debug, Clone, Copy)]
pub struct LaneCourse {
    /// Width of one horse lane in meters.
    pub horse_lane: f64,
    /// Widest lane offset a runner can take.
    pub max_lane_distance: f64,
}

/// Which rule set produced the target lane.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LaneMode {
    /// No overtake targets.
    Normal,
    /// At least one overtake target, or the linger after losing them.
    Overtake,
}

/// Whether `other` is inside the runner's vision cone (mechanics § Vision):
/// ahead within the visible distance, and across within a cone whose width
/// grows from two horse lanes at zero distance to 13.5 at the limit.
pub fn is_visible(me: &LaneSelf, other: &RunnerSnapshot, course: &LaneCourse) -> bool {
    let distance_gap = other.position - me.position;
    if !(0.0..=VISIBLE_DISTANCE).contains(&distance_gap) {
        return false;
    }
    let half_width = ((distance_gap / VISIBLE_DISTANCE) * 11.5 * course.horse_lane
        + 2.0 * course.horse_lane)
        / 2.0;
    (other.current_lane - me.current_lane).abs() <= half_width
}

/// The runners worth overtaking (mechanics § Overtake Targets): visible, 1 to
/// 20 m ahead, catchable within 15 s at the current speed difference, and
/// either slower by target speed or blocked and slower than the runner's own
/// target. The closest front blocker is always one.
pub fn overtake_targets<'a>(
    me: &LaneSelf,
    others: &'a [RunnerSnapshot],
    course: &LaneCourse,
) -> Vec<&'a RunnerSnapshot> {
    others
        .iter()
        .filter(|other| other.id != me.id)
        .filter(|other| {
            if me.front_blocker == Some(other.id) {
                return true;
            }
            let distance_gap = other.position - me.position;
            if !(1.0..=VISIBLE_DISTANCE).contains(&distance_gap) || !is_visible(me, other, course) {
                return false;
            }
            let speed_gap = me.current_speed - other.current_speed;
            let catchable = speed_gap > 0.0 && distance_gap / speed_gap < 15.0;
            let slower = other.target_speed < me.target_speed
                || (other.is_front_blocked && other.current_speed < me.target_speed);
            catchable && slower
        })
        .collect()
}

/// Whether the runner can move from its lane to `lane` without a runner
/// beside it in the way (mechanics § Side Blocking): nothing within 1.05 m
/// fore or aft whose lane lies between the two, widened by the candidate's
/// half width on the far side.
pub fn side_space_free(
    me: &LaneSelf,
    others: &[RunnerSnapshot],
    lane: f64,
    course: &LaneCourse,
) -> bool {
    let margin = CANDIDATE_HALF_WIDTH_LANES * course.horse_lane;
    let (low, high) = if lane >= me.current_lane {
        (me.current_lane, lane + margin)
    } else {
        (lane - margin, me.current_lane)
    };
    !others.iter().any(|other| {
        other.id != me.id
            && (other.position - me.position).abs() < SIDE_BLOCK_DISTANCE
            && other.current_lane > low
            && other.current_lane < high
            && (other.current_lane - me.current_lane).abs() > f64::EPSILON
    })
}

/// Whether any visible runner occupies `lane` between the runner and `until`
/// meters along the course.
fn lane_occupied(
    me: &LaneSelf,
    others: &[RunnerSnapshot],
    lane: f64,
    until: f64,
    course: &LaneCourse,
) -> bool {
    let half_width = CANDIDATE_HALF_WIDTH_LANES * course.horse_lane;
    others.iter().any(|other| {
        other.id != me.id
            && is_visible(me, other, course)
            && other.position >= me.position
            && other.position <= until
            && (other.current_lane - lane).abs() <= half_width
    })
}

/// The crowd a target belongs to: runners linked by chains of 0 to 3 m along
/// the course and under two horse lanes across. The runner looking for a way
/// past is never part of it.
fn crowd_of<'a>(
    me: RunnerId,
    target: &'a RunnerSnapshot,
    others: &'a [RunnerSnapshot],
    course: &LaneCourse,
) -> Vec<&'a RunnerSnapshot> {
    let mut crowd: Vec<&RunnerSnapshot> = vec![target];
    let mut frontier = vec![target];
    while let Some(member) = frontier.pop() {
        for other in others {
            if other.id == me || crowd.iter().any(|c| c.id == other.id) {
                continue;
            }
            let distance_gap = (other.position - member.position).abs();
            let lane_gap = (other.current_lane - member.current_lane).abs();
            if distance_gap <= CROWD_DISTANCE
                && lane_gap > 0.0
                && lane_gap < 2.0 * course.horse_lane
            {
                crowd.push(other);
                frontier.push(other);
            }
        }
    }
    crowd
}

/// Score a candidate: distance to move, weighted against moving out early in
/// the race (mechanics § Overtake Mode).
fn candidate_score(me: &LaneSelf, lane: f64) -> f64 {
    let outside = lane > me.current_lane;
    let coefficient = match (me.phase_index, outside) {
        (0, true) => 100.0,
        (2 | 3, true) => 1.15,
        _ => 1.0,
    };
    (lane - me.current_lane).abs() * coefficient
}

/// Overtake mode (mechanics § Overtake Mode): candidate lanes one horse lane
/// inside and outside each target's crowd, plus one lane in (early and mid
/// race) or straight ahead, each kept only when free and reachable, scored
/// by distance, with the extra move lane taking over when the pick sits
/// inside it.
pub fn overtake_target_lane(
    me: &LaneSelf,
    targets: &[&RunnerSnapshot],
    others: &[RunnerSnapshot],
    course: &LaneCourse,
) -> f64 {
    let horse_lane = course.horse_lane;
    let mut candidates: Vec<f64> = Vec::new();
    for target in targets {
        let crowd = crowd_of(me.id, target, others, course);
        let (Some(inner), Some(outer)) = (
            crowd
                .iter()
                .min_by(|a, b| a.current_lane.total_cmp(&b.current_lane)),
            crowd
                .iter()
                .max_by(|a, b| a.current_lane.total_cmp(&b.current_lane)),
        ) else {
            continue;
        };
        for (member, lane) in [
            (inner, inner.current_lane - horse_lane),
            (outer, outer.current_lane + horse_lane),
        ] {
            let lane = lane.clamp(0.0, course.max_lane_distance);
            if !lane_occupied(me, others, lane, member.position + 0.5, course) {
                candidates.push(lane);
            }
        }
    }

    let furthest_target = targets
        .iter()
        .map(|t| t.position)
        .fold(me.position, f64::max);
    let straight_or_in = if me.phase_index <= 1 && me.current_lane >= horse_lane {
        me.current_lane - horse_lane
    } else {
        me.current_lane
    };
    if !lane_occupied(
        me,
        others,
        straight_or_in,
        furthest_target + CROWD_DISTANCE,
        course,
    ) {
        candidates.push(straight_or_in);
    }

    let accepted = candidates
        .into_iter()
        .filter(|&lane| side_space_free(me, others, lane, course))
        .min_by(|a, b| candidate_score(me, *a).total_cmp(&candidate_score(me, *b)))
        .unwrap_or(me.current_lane);

    if me.extra_move_lane >= 0.0
        && accepted < me.extra_move_lane
        && side_space_free(me, others, me.extra_move_lane, course)
    {
        me.extra_move_lane
    } else {
        accepted
    }
}

/// Normal mode (mechanics § Normal Mode), rules in the documented order.
pub fn normal_target_lane(me: &LaneSelf, others: &[RunnerSnapshot], course: &LaneCourse) -> f64 {
    let horse_lane = course.horse_lane;
    if me.out_of_hp {
        return me.current_lane;
    }
    if me.pace_down {
        return PACE_DOWN_LANE;
    }
    if me.on_final_straight
        && me.extra_move_lane > me.current_lane
        && side_space_free(me, others, me.extra_move_lane, course)
    {
        return me.extra_move_lane;
    }
    if me.phase_index <= 1 {
        // Rule 4: drift in while the inside is open.
        let inward = (me.current_lane - INWARD_DRIFT).max(0.0);
        if side_space_free(me, others, inward, course) {
            return inward;
        }
    }
    if me.phase_index == 1 {
        // Rule 5, reached only when the inward move is blocked: keep two horse
        // lanes off the nearest runner inside.
        // ASSUMPTION: "inside uma" reaches the crowd distance along the course.
        let inside = others
            .iter()
            .filter(|other| other.id != me.id)
            .filter(|other| (other.position - me.position).abs() <= CROWD_DISTANCE)
            .filter(|other| other.current_lane < me.current_lane)
            .max_by(|a, b| a.current_lane.total_cmp(&b.current_lane));
        if let Some(inside) = inside {
            if me.current_lane - inside.current_lane < 1.75 * horse_lane {
                return (inside.current_lane + 2.0 * horse_lane).min(course.max_lane_distance);
            }
        }
    }
    me.current_lane
}

/// The mode and target lane for this tick.
pub fn resolve_target_lane(
    me: &LaneSelf,
    others: &[RunnerSnapshot],
    course: &LaneCourse,
    lingering: bool,
) -> (LaneMode, f64) {
    let targets = overtake_targets(me, others, course);
    if targets.is_empty() && !lingering {
        return (LaneMode::Normal, normal_target_lane(me, others, course));
    }
    (
        LaneMode::Overtake,
        overtake_target_lane(me, &targets, others, course),
    )
}

/// The outward bump when two runners overlap (mechanics § Overlapping): the
/// outer of the pair is moved 0.4 horse lane out at once. Returns the new lane
/// when this runner is the outer one of an overlapping pair; at exactly equal
/// lanes the higher id moves, so one of the pair stays put.
pub fn overlap_bump(me: &LaneSelf, others: &[RunnerSnapshot], course: &LaneCourse) -> Option<f64> {
    let overlapping = others.iter().any(|other| {
        other.id != me.id
            && (other.position - me.position).abs() < 0.4
            && (other.current_lane - me.current_lane).abs() < OVERLAP_BUMP_LANES * course.horse_lane
            && (other.current_lane < me.current_lane
                || (other.current_lane == me.current_lane && other.id.0 < me.id.0))
    });
    overlapping.then(|| {
        (me.current_lane + OVERLAP_BUMP_LANES * course.horse_lane).min(course.max_lane_distance)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const HL: f64 = 0.625;

    fn course() -> LaneCourse {
        LaneCourse {
            horse_lane: HL,
            max_lane_distance: 14.0625,
        }
    }

    fn me(position: f64, lane: f64) -> LaneSelf {
        LaneSelf {
            id: RunnerId(0),
            position,
            current_lane: lane,
            current_speed: 21.0,
            target_speed: 22.0,
            phase_index: 1,
            extra_move_lane: -1.0,
            out_of_hp: false,
            pace_down: false,
            on_final_straight: false,
            front_blocker: None,
        }
    }

    fn other(id: u32, position: f64, lane: f64, speed: f64, target: f64) -> RunnerSnapshot {
        RunnerSnapshot {
            id: RunnerId(id),
            position,
            current_lane: lane,
            current_speed: speed,
            target_speed: target,
            is_front_blocked: false,
        }
    }

    #[test]
    fn vision_cone_widens_with_distance() {
        let c = course();
        let m = me(100.0, 2.0);
        // Two horse lanes wide at zero distance: one lane either side.
        assert!(is_visible(
            &m,
            &other(1, 100.5, 2.0 + 0.9 * HL, 20.0, 20.0),
            &c
        ));
        assert!(!is_visible(
            &m,
            &other(1, 100.5, 2.0 + 1.2 * HL, 20.0, 20.0),
            &c
        ));
        // Wider at the limit.
        assert!(is_visible(
            &m,
            &other(1, 119.0, 2.0 + 6.0 * HL, 20.0, 20.0),
            &c
        ));
        assert!(!is_visible(&m, &other(1, 121.0, 2.0, 20.0, 20.0), &c));
    }

    #[test]
    fn overtake_targets_need_a_catchable_slower_runner_or_a_blocker() {
        let c = course();
        let m = me(100.0, 2.0);
        let slower = other(1, 105.0, 2.0, 20.0, 21.0);
        let faster_target = other(2, 105.0, 2.5, 20.0, 23.0);
        let too_far = other(3, 130.0, 2.0, 20.0, 21.0);
        let uncatchable = other(4, 105.0, 2.0, 21.5, 21.0);
        let field = vec![slower, faster_target, too_far, uncatchable];
        let ids: Vec<u32> = overtake_targets(&m, &field, &c)
            .iter()
            .map(|t| t.id.0)
            .collect();
        assert_eq!(ids, vec![1]);

        let blocked = LaneSelf {
            front_blocker: Some(RunnerId(2)),
            ..m
        };
        let ids: Vec<u32> = overtake_targets(&blocked, &field, &c)
            .iter()
            .map(|t| t.id.0)
            .collect();
        assert_eq!(ids, vec![1, 2]);
    }

    #[test]
    fn overtake_mode_goes_around_the_crowd_and_prefers_inside_when_free() {
        let c = course();
        let m = me(100.0, 2.0);
        // A two-runner crowd straight ahead: lanes 1.9 and 2.4.
        let field = vec![
            other(1, 104.0, 1.9, 20.0, 21.0),
            other(2, 105.0, 2.4, 20.0, 21.0),
        ];
        let targets = overtake_targets(&m, &field, &c);
        assert_eq!(targets.len(), 2);
        let lane = overtake_target_lane(&m, &targets, &field, &c);
        // Candidates: one lane in (1.375, score 0.625), the crowd's inside
        // lane (1.9 - HL = 1.275, score 0.725) and its outside lane (2.4 + HL
        // = 3.025, score 1.025). All free; the cheapest move wins.
        assert!((lane - 1.375).abs() < 1e-9, "lane {lane}");
    }

    #[test]
    fn early_race_weighs_outside_moves_a_hundredfold() {
        let c = course();
        let m = LaneSelf {
            phase_index: 0,
            ..me(100.0, 0.3)
        };
        // Crowd hugging the rail: the inside candidate clamps to 0 but is
        // occupied by the rail runner; outside is the only free lane.
        let field = vec![other(1, 104.0, 0.2, 20.0, 21.0)];
        let targets = overtake_targets(&m, &field, &c);
        let lane = overtake_target_lane(&m, &targets, &field, &c);
        assert!((lane - (0.2 + HL)).abs() < 1e-9, "lane {lane}");
    }

    #[test]
    fn normal_mode_keeps_two_lanes_off_the_inside_runner_in_mid_race() {
        let c = course();
        let m = me(100.0, 1.0);
        let field = vec![other(1, 101.0, 0.5, 21.0, 22.0)];
        let lane = normal_target_lane(&m, &field, &c);
        assert!((lane - (0.5 + 2.0 * HL)).abs() < 1e-9, "lane {lane}");
    }

    #[test]
    fn normal_mode_drifts_in_when_the_inside_is_open() {
        let c = course();
        let m = me(100.0, 1.0);
        let lane = normal_target_lane(&m, &[], &c);
        assert!((lane - 0.95).abs() < 1e-9);
        let held = LaneSelf {
            phase_index: 2,
            ..m
        };
        assert_eq!(normal_target_lane(&held, &[], &c), 1.0);
    }

    #[test]
    fn side_blocked_moves_are_refused() {
        let c = course();
        let m = me(100.0, 1.0);
        let beside = vec![other(1, 100.5, 1.4, 21.0, 22.0)];
        assert!(!side_space_free(&m, &beside, 2.0, &c));
        assert!(side_space_free(&m, &beside, 0.5, &c));
    }

    #[test]
    fn the_reviewing_runner_is_never_part_of_the_crowd_it_passes() {
        let c = course();
        // Sitting right behind and beside the target: close enough to be
        // chained into its crowd if the runner were not excluded.
        let m = me(100.0, 2.0);
        let field = vec![other(1, 101.5, 2.5, 20.0, 21.0)];
        let crowd = crowd_of(m.id, &field[0], &field, &c);
        assert_eq!(crowd.len(), 1);
        assert_eq!(crowd[0].id, RunnerId(1));
    }

    #[test]
    fn equal_lane_overlap_bumps_one_runner_only() {
        let c = course();
        let low = me(100.0, 1.0);
        let high = LaneSelf {
            id: RunnerId(5),
            ..me(100.1, 1.0)
        };
        let as_seen_by_low = vec![other(5, 100.1, 1.0, 21.0, 22.0)];
        let as_seen_by_high = vec![other(0, 100.0, 1.0, 21.0, 22.0)];
        assert_eq!(overlap_bump(&low, &as_seen_by_low, &c), None);
        assert_eq!(
            overlap_bump(&high, &as_seen_by_high, &c),
            Some(1.0 + 0.4 * HL)
        );
    }

    #[test]
    fn overlap_bumps_only_the_outer_runner() {
        let c = course();
        let inner = other(1, 100.1, 1.0, 21.0, 22.0);
        let outer = me(100.0, 1.1);
        assert_eq!(overlap_bump(&outer, &[inner], &c), Some(1.1 + 0.4 * HL));
        let inner_self = me(100.0, 0.9);
        assert_eq!(
            overlap_bump(&inner_self, &[other(1, 100.1, 1.0, 21.0, 22.0)], &c),
            None
        );
    }
}
