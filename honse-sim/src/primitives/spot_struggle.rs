//! Spot Struggle (Lead Competition 位置取り争い) — the cross-runner rule that
//! starts and ends a struggle, as a **domain service** both engines call.
//!
//! The runner kernel owns the self-side of the mechanic: the duration, the
//! section-9 cap, and the scripted forced regions (`Runner::update_spot_struggle`).
//! What one runner cannot decide alone is *who struggles alongside her*, so the
//! group trigger and the distance/lateral exit live here, over plain rows rather
//! than over runners.
//!
//! Each engine freezes one row per runner from a single frame, runs the passes,
//! and lets them apply the result. Keeping the rule in one module is what stops
//! the contested and synthetic paradigms from drifting apart (ADR-0005): the
//! synthetic engine reaches the same verdict from a **smaller field**, not from a
//! looser rule.
//!
//! Canon and its evidence: `docs/race-mechanics/` § *Spot Struggle*, plus the
//! amendments recorded in `docs/race-mechanics/GLOBAL.md`. Two of those
//! amendments are load-bearing here and are called out at their constants: the
//! 150m unlock is **field-global**, and `DistanceGap2` / `LaneGap2` (5.0m /
//! 0.416 course widths) are **exit** constants that must not be reused as entry
//! constants — Runaway does not get a wider entry range.

use crate::runner::Runner;
use crate::shared_kernel::ids::RunnerId;
use crate::shared_kernel::language::Strategy;

/// Longitudinally, how close a runner must be to the frontmost runner of her
/// style to be pulled into the struggle. Identical for both styles: measured
/// data shows Runaway does not get a wider entry range.
const ENTRY_DISTANCE_GAP: f64 = 3.75;
/// The same, laterally, in course widths.
const ENTRY_LANE_GAP_WIDTHS: f64 = 0.165;
/// At least one grouped runner must still be inside this section. The lower
/// bound of the entry window is the field-global unlock, not a per-runner gate.
const ENTRY_WINDOW_SECTIONS: f64 = 6.0;
/// Any runner reaching this distance unlocks spot struggle for the whole field.
const UNLOCK_DISTANCE: f64 = 150.0;
/// A struggle always ends once this section is reached, whatever duration is
/// left on the timer.
const END_SECTION: f64 = 8.0;
/// The early distance exit: this far behind *every* other struggler of her style.
const EXIT_DISTANCE_GAP: f64 = 5.0;
/// The early lateral exit: this far from every one of them, in course widths.
const EXIT_LANE_GAP_WIDTHS: f64 = 0.416;

/// One runner, frozen for a single spot-struggle pass.
///
/// Plain data on purpose: the rule never asks which engine produced it, and the
/// engine that calls it never has to re-read the field twice.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SpotStruggleRow {
    /// Runner id.
    pub id: RunnerId,
    /// Immutable running style.
    pub strategy: Strategy,
    /// Longitudinal position.
    pub position: f64,
    /// Lateral lane offset.
    pub lane: f64,
    /// One twenty-fourth of the course, in metres.
    pub section_length: f64,
    /// Whether the runner has crossed the line.
    pub finished: bool,
    /// Whether the runner is in a struggle right now.
    pub active: bool,
    /// Whether the runner has entered a struggle this race (her start position
    /// is recorded). A runner who has entered is out of the group rule for the
    /// rest of the race, so she can never be pulled back in.
    pub entered: bool,
    /// Whether the runner is inside a scripted forced region. Forced strugglers
    /// are exempt from the exit pass, which would otherwise end a stretch the
    /// caller explicitly asked for.
    pub forced: bool,
    /// Whether the runner's struggle ended through the distance exit rather than
    /// through duration.
    pub distance_exited: bool,
}

/// One runner entering a struggle, with the position the struggle ends at.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SpotStruggleStart {
    /// The runner entering.
    pub id: RunnerId,
    /// The style whose once-per-race trigger this entry spends.
    pub strategy: Strategy,
    /// Absolute position the struggle ends at, shared by the whole group.
    pub end_position: f64,
}

/// Race-level spot-struggle state. Each engine's aggregate owns one and resets it
/// in `prepare_round`, so a round depends only on its own inputs and seed.
#[derive(Debug, Default)]
pub struct SpotStruggleState {
    /// Field-global unlock: set once **any** runner passes 150m this round, and
    /// never cleared before the next round. One uma passing 150m unlocks the
    /// mechanic for the whole field, so a trailing front runner can enter before
    /// her own 150m mark.
    pub unlocked: bool,
    /// Styles that already triggered spot struggle this round. Each style
    /// triggers at most once per race.
    pub triggered: Vec<Strategy>,
}

impl SpotStruggleState {
    /// Reset to the pre-round state.
    pub fn reset(&mut self) {
        self.unlocked = false;
        self.triggered.clear();
    }
}

/// Freeze one frame of runner state into the rows the rule reads.
pub fn spot_struggle_rows(runners: &[Runner]) -> Vec<SpotStruggleRow> {
    runners
        .iter()
        .map(|runner| SpotStruggleRow {
            id: runner.id,
            strategy: runner.strategy,
            position: runner.position,
            lane: runner.current_lane,
            section_length: runner.section_length,
            finished: runner.finished,
            active: runner.in_spot_struggle,
            entered: runner.spot_struggle_start_position.is_some(),
            forced: runner.is_in_forced_spot_struggle,
            distance_exited: runner.spot_struggle_distance_exited,
        })
        .collect()
}

/// Whether spot struggle is available to the field: any runner at or past 150m,
/// or already finished, unlocks it for everyone.
pub fn spot_struggle_unlocked(rows: &[SpotStruggleRow]) -> bool {
    rows.iter()
        .any(|row| row.finished || row.position >= UNLOCK_DISTANCE)
}

/// The natural entries for one frame: for each style, the group bunched behind
/// the **frontmost** runner of that style enters together.
///
/// The verdict is computed from frozen rows, so it does not depend on the order
/// runners are visited, and a style listed in `triggered` is skipped for the rest
/// of the race.
pub fn spot_struggle_entries(
    rows: &[SpotStruggleRow],
    course_width: f64,
    triggered: &[Strategy],
) -> Vec<SpotStruggleStart> {
    let entry_lane_gap = ENTRY_LANE_GAP_WIDTHS * course_width;
    let mut starts: Vec<SpotStruggleStart> = Vec::new();

    // Styles never mix: front runners struggle with front runners, runaways with
    // runaways, and `Strategy` equality is the whole of that rule. Each style is
    // visited once, so the caller's spent-trigger list is the only reason to skip
    // one.
    for style in [Strategy::FrontRunner, Strategy::Runaway] {
        if triggered.contains(&style) {
            continue;
        }

        let members: Vec<SpotStruggleRow> = rows
            .iter()
            .copied()
            .filter(|row| !row.finished && !row.entered && row.strategy == style)
            .collect();
        if members.len() < 2 {
            continue;
        }

        let Some(frontmost) = members
            .iter()
            .max_by(|a, b| a.position.total_cmp(&b.position))
        else {
            continue;
        };

        let group: Vec<SpotStruggleRow> = members
            .iter()
            .copied()
            .filter(|row| {
                let behind = frontmost.position - row.position;
                (0.0..ENTRY_DISTANCE_GAP).contains(&behind)
                    && (row.lane - frontmost.lane).abs() < entry_lane_gap
            })
            .collect();
        if group.len() < 2 {
            continue;
        }

        let window_end = (frontmost.section_length * ENTRY_WINDOW_SECTIONS).floor();
        if !group.iter().any(|row| row.position <= window_end) {
            continue;
        }

        // The struggle always ends at section 9 (absolute), so every member of a
        // group shares one end position rather than counting sections from her
        // own start.
        let end_position = (frontmost.section_length * END_SECTION).floor();
        starts.extend(group.iter().map(|row| SpotStruggleStart {
            id: row.id,
            strategy: style,
            end_position,
        }));
    }

    starts
}

/// The early exits for one frame.
///
/// An active struggler leaves when she is far enough behind **every** other
/// struggler of her style, or far enough to the side of all of them. When every
/// other participant already left through the distance exit, the last one leaves
/// with them — natural expiry does not cascade, which is why the cascade asks
/// about `distance_exited` rather than about who is still active.
pub fn spot_struggle_exits(rows: &[SpotStruggleRow], course_width: f64) -> Vec<RunnerId> {
    let exit_lane_gap = EXIT_LANE_GAP_WIDTHS * course_width;
    let participants: Vec<SpotStruggleRow> = rows
        .iter()
        .copied()
        .filter(|row| row.entered && !row.forced)
        .collect();

    let mut exits: Vec<RunnerId> = Vec::new();

    for row in participants.iter().filter(|row| row.active) {
        let others: Vec<SpotStruggleRow> = participants
            .iter()
            .copied()
            .filter(|other| other.id != row.id && other.strategy == row.strategy)
            .collect();
        if others.is_empty() {
            continue;
        }

        let active_others: Vec<SpotStruggleRow> = others
            .iter()
            .copied()
            .filter(|other| other.active)
            .collect();
        if active_others.is_empty() {
            if others.iter().all(|other| other.distance_exited) {
                exits.push(row.id);
            }
            continue;
        }

        let behind_all = active_others
            .iter()
            .all(|other| other.position - row.position >= EXIT_DISTANCE_GAP);
        let lateral_all = active_others
            .iter()
            .all(|other| (other.lane - row.lane).abs() >= exit_lane_gap);
        if behind_all || lateral_all {
            exits.push(row.id);
        }
    }

    exits
}

/// Run the group-trigger pass over the whole field and apply it.
///
/// Every runner in the frame is judged against the same frozen positions: the
/// rows are read once, before any runner is mutated.
pub fn run_spot_struggle_groups(
    runners: &mut [Runner],
    course_width: f64,
    state: &mut SpotStruggleState,
) {
    let rows = spot_struggle_rows(runners);

    if !state.unlocked {
        state.unlocked = spot_struggle_unlocked(&rows);
    }
    if !state.unlocked {
        return;
    }

    for start in spot_struggle_entries(&rows, course_width, &state.triggered) {
        if !state.triggered.contains(&start.strategy) {
            state.triggered.push(start.strategy);
        }
        if let Some(runner) = runners.iter_mut().find(|runner| runner.id == start.id) {
            runner.spot_struggle_timer.t = 0.0;
            runner.in_spot_struggle = true;
            runner.spot_struggle_start_position = Some(runner.position);
            runner.spot_struggle_end_position = start.end_position;
        }
    }
}

/// Run the early-exit pass over the whole field and apply it.
pub fn run_spot_struggle_exits(runners: &mut [Runner], course_width: f64) {
    let exits = spot_struggle_exits(&spot_struggle_rows(runners), course_width);

    for id in exits {
        if let Some(runner) = runners.iter_mut().find(|runner| runner.id == id) {
            runner.in_spot_struggle = false;
            runner.spot_struggle_distance_exited = true;
            runner.spot_struggle_end_position = runner.position;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Section length is 100m, so section 9 starts at 800m and section 6 ends at
    /// 600m — small enough that the test positions read as fractions of a
    /// course.
    const SECTION: f64 = 100.0;
    const COURSE_WIDTH: f64 = 11.25;

    fn row(id: u32, strategy: Strategy, position: f64) -> SpotStruggleRow {
        SpotStruggleRow {
            id: RunnerId(id),
            strategy,
            position,
            lane: 0.5,
            section_length: SECTION,
            finished: false,
            active: false,
            entered: false,
            forced: false,
            distance_exited: false,
        }
    }

    fn ids(starts: &[SpotStruggleStart]) -> Vec<u32> {
        let mut ids: Vec<u32> = starts.iter().map(|start| start.id.0).collect();
        ids.sort_unstable();
        ids
    }

    #[test]
    fn bunched_pair_enters_together_and_ends_at_section_nine() {
        let rows = vec![
            row(0, Strategy::FrontRunner, 400.0),
            row(1, Strategy::FrontRunner, 397.5),
            // 50m back: outside the entry gap behind the frontmost.
            row(2, Strategy::FrontRunner, 350.0),
        ];

        let starts = spot_struggle_entries(&rows, COURSE_WIDTH, &[]);

        assert_eq!(ids(&starts), vec![0, 1]);
        // Every member of the group shares the frontmost's section-9 cap.
        assert!(starts.iter().all(|start| start.end_position == 800.0));
        assert!(starts
            .iter()
            .all(|start| start.strategy == Strategy::FrontRunner));
    }

    #[test]
    fn entry_ignores_a_pair_split_across_lanes() {
        // Bunched longitudinally but 2m apart laterally, which is well past the
        // 0.165 course width (1.86m) entry gap.
        let rows = vec![
            row(0, Strategy::FrontRunner, 400.0),
            SpotStruggleRow {
                lane: 2.5,
                ..row(1, Strategy::FrontRunner, 398.0)
            },
        ];

        assert!(spot_struggle_entries(&rows, COURSE_WIDTH, &[]).is_empty());
    }

    #[test]
    fn entry_never_mixes_styles() {
        // One front runner and one runaway, bunched. Each style has a single
        // member, so neither can form a group of two.
        let rows = vec![
            row(0, Strategy::FrontRunner, 400.0),
            row(1, Strategy::Runaway, 398.0),
        ];

        assert!(spot_struggle_entries(&rows, COURSE_WIDTH, &[]).is_empty());
    }

    #[test]
    fn runaways_use_the_front_runner_entry_gap() {
        // 4m apart: inside the 5.0m *exit* constant, outside the 3.75m entry gap.
        // Reusing the exit constant here would wrongly trigger.
        let rows = vec![
            row(0, Strategy::Runaway, 400.0),
            row(1, Strategy::Runaway, 396.0),
        ];

        assert!(spot_struggle_entries(&rows, COURSE_WIDTH, &[]).is_empty());
    }

    #[test]
    fn a_style_triggers_once_per_race() {
        let rows = vec![
            row(0, Strategy::FrontRunner, 400.0),
            row(1, Strategy::FrontRunner, 398.0),
        ];

        assert_eq!(spot_struggle_entries(&rows, COURSE_WIDTH, &[]).len(), 2);
        assert!(spot_struggle_entries(&rows, COURSE_WIDTH, &[Strategy::FrontRunner]).is_empty());
    }

    #[test]
    fn group_outside_section_six_does_not_enter() {
        // 750m is past the end of section 6 (600m), so the window has closed even
        // though the pair is bunched and the field is unlocked.
        let rows = vec![
            row(0, Strategy::FrontRunner, 760.0),
            row(1, Strategy::FrontRunner, 758.0),
        ];

        assert!(spot_struggle_entries(&rows, COURSE_WIDTH, &[]).is_empty());
    }

    #[test]
    fn unlock_is_field_global_and_ignores_style() {
        // A bunched pair below 150m forms a valid group, but the mechanic is
        // still locked. The gate is the field, not the pair.
        let pair_below_the_unlock = vec![
            row(0, Strategy::FrontRunner, 140.0),
            row(1, Strategy::FrontRunner, 138.0),
        ];
        assert!(!spot_struggle_unlocked(&pair_below_the_unlock));

        // Any runner unlocks it for the whole field — including a Pace Chaser,
        // who can never struggle herself.
        let with_a_leader = vec![
            row(0, Strategy::FrontRunner, 140.0),
            row(1, Strategy::FrontRunner, 138.0),
            row(2, Strategy::PaceChaser, 400.0),
        ];
        assert!(spot_struggle_unlocked(&with_a_leader));

        // A runner who has already crossed the line unlocks it too.
        let finished = vec![SpotStruggleRow {
            finished: true,
            ..row(0, Strategy::FrontRunner, 0.0)
        }];
        assert!(spot_struggle_unlocked(&finished));
    }

    #[test]
    fn former_strugglers_cannot_be_pulled_back_in() {
        let rows = vec![
            SpotStruggleRow {
                entered: true,
                ..row(0, Strategy::FrontRunner, 400.0)
            },
            row(1, Strategy::FrontRunner, 398.0),
        ];

        assert!(spot_struggle_entries(&rows, COURSE_WIDTH, &[]).is_empty());
    }

    #[test]
    fn distance_exit_then_cascade_removes_the_last_struggler() {
        let struggling = |id: u32, position: f64| SpotStruggleRow {
            active: true,
            entered: true,
            position,
            ..row(id, Strategy::FrontRunner, position)
        };

        let rows = vec![
            struggling(0, 250.0),
            struggling(1, 250.0),
            struggling(2, 244.0),
        ];
        // Runner 2 is 6m behind both of the others: distance exit.
        assert_eq!(spot_struggle_exits(&rows, COURSE_WIDTH), vec![RunnerId(2)]);

        // Runner 1 joins her; runner 0 is now the only active struggler and
        // everyone else left by distance, so she cascades out.
        let cascading = vec![
            struggling(0, 250.0),
            SpotStruggleRow {
                active: false,
                entered: true,
                distance_exited: true,
                position: 244.5,
                ..row(1, Strategy::FrontRunner, 244.5)
            },
            SpotStruggleRow {
                active: false,
                entered: true,
                distance_exited: true,
                position: 244.0,
                ..row(2, Strategy::FrontRunner, 244.0)
            },
        ];
        assert_eq!(
            spot_struggle_exits(&cascading, COURSE_WIDTH),
            vec![RunnerId(0)]
        );
    }

    #[test]
    fn natural_expiry_does_not_cascade() {
        let rows = vec![
            SpotStruggleRow {
                active: true,
                entered: true,
                position: 250.0,
                ..row(0, Strategy::FrontRunner, 250.0)
            },
            // Ran her duration out rather than exiting by distance.
            SpotStruggleRow {
                active: false,
                entered: true,
                distance_exited: false,
                position: 250.0,
                ..row(1, Strategy::FrontRunner, 250.0)
            },
        ];

        assert!(spot_struggle_exits(&rows, COURSE_WIDTH).is_empty());
    }

    #[test]
    fn lateral_exit_needs_clearance_from_every_other_struggler() {
        let rows = vec![
            SpotStruggleRow {
                active: true,
                entered: true,
                position: 250.0,
                ..row(0, Strategy::FrontRunner, 250.0)
            },
            SpotStruggleRow {
                active: true,
                entered: true,
                position: 250.0,
                lane: 6.0,
                ..row(1, Strategy::FrontRunner, 250.0)
            },
            SpotStruggleRow {
                active: true,
                entered: true,
                position: 249.0,
                lane: 6.0,
                ..row(2, Strategy::FrontRunner, 249.0)
            },
        ];

        // Runner 0 sits 5.5m outside both of the others, past the 0.416 course
        // width exit gap, so she leaves. Runners 1 and 2 share a lane with each
        // other, so neither clears *every* other struggler and both stay.
        assert_eq!(spot_struggle_exits(&rows, COURSE_WIDTH), vec![RunnerId(0)]);
    }

    #[test]
    fn a_forced_struggler_is_exempt_from_the_exit_pass() {
        let rows = vec![
            SpotStruggleRow {
                active: true,
                entered: true,
                forced: true,
                position: 100.0,
                ..row(0, Strategy::FrontRunner, 100.0)
            },
            SpotStruggleRow {
                active: true,
                entered: true,
                position: 400.0,
                ..row(1, Strategy::FrontRunner, 400.0)
            },
        ];

        // The scripted stretch ends when the caller's region ends, not when the
        // partner runs away from her.
        assert!(spot_struggle_exits(&rows, COURSE_WIDTH).is_empty());
    }
}
