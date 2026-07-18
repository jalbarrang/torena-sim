//! Virtual position-keep **domain service** — the pace-up/down/overtake state
//! machine runners follow relative to the pacer.
//!
//! Port of `poskeep/virtual-position-keep.ts`. These are free functions over a
//! `&mut Runner` plus a [`PositionKeepContext`] (the race-derived read-only
//! inputs: pacer position, second-place position, field size, mode). Computing
//! the context in the aggregate keeps the borrow of "self" disjoint from the
//! read of the rest of the field, sidestepping the TS `runner.race` back-pointer.

use crate::course::coefficients::position_keep;
use crate::runner::{PositionKeepActivation, Runner};
use crate::shared_kernel::language::{strategy_matches, Phase, Strategy};
use crate::shared_kernel::math::Timer;
use crate::skills::effect::PositionKeepState;

/// The `positionKeepMode` value enabling virtual position keeping.
const VIRTUAL_MODE: i32 = 2;
/// Minimum field size assumed by the forced-rank gap calculation (matches the
/// TS hard-coded `numUmas = 9`). Fields larger than 9 use the real size so
/// ranks 10..=12 don't compress the gap range; smaller fields keep the 9-based
/// normalization for TS parity (and to avoid degenerate divisors).
const FORCED_RANK_FIELD_SIZE: f64 = 9.0;

/// Race-derived, read-only inputs the position-keep machine needs about the rest
/// of the field. Built by the aggregate each tick.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PositionKeepContext {
    /// The race's `positionKeepMode` setting.
    pub position_keep_mode: i32,
    /// Number of runners still racing (active, unfinished).
    pub num_runners: usize,
    /// Total field size (finished + active). Stable across the round; used to
    /// normalize forced-rank gaps.
    pub field_size: usize,
    /// The pacer's current position, if a pacer is selected.
    pub pacer_position: Option<f64>,
    /// The pacer's post-promotion position-keep strategy, if a pacer is selected.
    pub pacer_strategy: Option<Strategy>,
    /// Whether this runner *is* the pacer.
    pub pacer_is_self: bool,
    /// Position of the second-furthest-forward runner, if any.
    pub second_place_position: Option<f64>,
    /// Whether any more-backward strategy is physically ahead of this runner.
    pub backward_strategy_runner_ahead: bool,
    /// Whether this runner is the only Front Runner / Runaway in the field
    /// (post-1.5 SpeedUp threshold uses 12.5m instead of 4.5m).
    pub only_front_runner: bool,
}

/// Wit check gating speed-up / overtake entry (always passes while rushed).
pub fn speed_up_overtake_wit_check(runner: &mut Runner) -> bool {
    if runner.is_rushed {
        return true;
    }
    let wit = runner.adjusted_stats.wit;
    runner.pos_keep_rng.random() < 0.2 * (0.1 * wit).log10()
}

/// Wit check gating pace-up entry (always passes while rushed).
pub fn pace_up_wit_check(runner: &mut Runner) -> bool {
    if runner.is_rushed {
        return true;
    }
    let wit = runner.adjusted_stats.wit;
    runner.pos_keep_rng.random() < 0.15 * (0.1 * wit).log10()
}

/// Set the speed coefficient implied by the runner's current position-keep state.
pub fn update_position_keep_coefficient(runner: &mut Runner) {
    runner.pos_keep_speed_coef = match runner.position_keep_state {
        PositionKeepState::SpeedUp => 1.04,
        PositionKeepState::Overtake => 1.05,
        PositionKeepState::PaceUp => 1.04,
        PositionKeepState::PaceDown => {
            // Global post-1.5: Pace Down is less severe during mid-race only.
            if runner.phase == Phase::MidRace {
                0.945
            } else {
                0.915
            }
        }
        PositionKeepState::PaceUpEx => 2.0,
        PositionKeepState::None => 1.0,
    };
}

/// The position past which position keeping stops. The engine supplies the
/// window `multiplier` (canon ×10 for sections 1–10) applied to the section
/// length — the domain service no longer knows the simulation paradigm.
pub fn calculate_pos_keep_end(section_length: f64, multiplier: f64) -> f64 {
    section_length * multiplier
}

/// Reset the position-keep state for a fresh round. `end_multiplier` is the
/// engine-supplied position-keep window multiplier (see
/// [`calculate_pos_keep_end`]).
pub fn initialize_position_keep(runner: &mut Runner, course_distance: f64, end_multiplier: f64) {
    runner.position_keep_state = PositionKeepState::None;
    runner.pos_keep_next_timer = Timer::new(0.0);
    runner.pos_keep_speed_coef = 1.0;
    runner.pos_keep_exit_distance = 0.0;
    runner.pos_keep_exit_position = 0.0;
    runner.pos_keep_min_threshold = position_keep::min_threshold(runner.strategy, course_distance);
    runner.pos_keep_max_threshold = position_keep::max_threshold(runner.strategy, course_distance);
    runner.position_keep_activations = Vec::new();
    runner.pos_keep_end = calculate_pos_keep_end(runner.section_length, end_multiplier);
}

/// Exit the current state, back-filling the last activation's end position and
/// optionally arming the cooldown timer.
pub fn exit_position_keep(runner: &mut Runner, next_timer_value: Option<f64>) {
    if runner.position_keep_state != PositionKeepState::None {
        if let Some(last) = runner.position_keep_activations.last_mut() {
            last.end = runner.position;
        }
    }

    runner.position_keep_state = PositionKeepState::None;

    if let Some(value) = next_timer_value {
        runner.pos_keep_next_timer.t = value;
    }
}

/// The exit position for an entered state: current position plus a section-length
/// lead (tripled for Runaway).
fn keep_exit_position(runner: &Runner) -> f64 {
    let lead = if runner.position_keep_strategy == Strategy::Runaway {
        3.0
    } else {
        1.0
    };
    runner.position + runner.section_length.floor() * lead
}

fn begin_state(runner: &mut Runner, state: PositionKeepState) {
    runner
        .position_keep_activations
        .push(PositionKeepActivation {
            start: runner.position,
            end: 0.0,
            state,
        });
    runner.position_keep_state = state;
}

/// Compute the forced-rank "behind" gap if the runner is within a forced-rank
/// region; `None` means no forced rank applies here.
fn forced_rank_behind(runner: &Runner, ctx: &PositionKeepContext) -> Option<f64> {
    for region in &runner.forced_rank {
        if runner.position >= region.start && runner.position < region.end {
            let max_gap = runner.pos_keep_max_threshold + runner.section_length;
            let field_size = (ctx.field_size as f64).max(FORCED_RANK_FIELD_SIZE);
            return Some(((region.rank - 1) as f64 / (field_size - 1.0)) * max_gap);
        }
    }
    None
}

/// The lead over second place when this runner is the pacer (`None` if there is
/// no second-place runner).
fn lead_over_second(runner: &Runner, ctx: &PositionKeepContext) -> Option<f64> {
    ctx.second_place_position
        .map(|second| runner.position - second)
}

/// SpeedUp lead threshold for a front-runner pacer (mechanics § Speed up mode).
///
/// Runaway keeps 17.5m. Post-1.5 anniversary: a solo Front Runner uses 12.5m;
/// otherwise 4.5m.
fn speed_up_lead_threshold(runner: &Runner, ctx: &PositionKeepContext) -> f64 {
    if runner.position_keep_strategy == Strategy::Runaway {
        17.5
    } else if ctx.only_front_runner {
        12.5
    } else {
        4.5
    }
}

/// Run the front-runner branch of the `None` state.
fn enter_from_none_front_runner(runner: &mut Runner, ctx: &PositionKeepContext) {
    if ctx.pacer_is_self {
        let Some(distance_ahead) = lead_over_second(runner, ctx) else {
            return;
        };
        let threshold = speed_up_lead_threshold(runner, ctx);
        if distance_ahead < threshold && speed_up_overtake_wit_check(runner) {
            begin_state(runner, PositionKeepState::SpeedUp);
            runner.pos_keep_exit_position = keep_exit_position(runner);
        }
    } else if speed_up_overtake_wit_check(runner) {
        begin_state(runner, PositionKeepState::Overtake);
    }
}

/// Run the non-front-runner branch of the `None` state.
fn enter_from_none_pacer(runner: &mut Runner, behind: f64) {
    if behind > runner.pos_keep_max_threshold {
        if pace_up_wit_check(runner) {
            begin_state(runner, PositionKeepState::PaceUp);
            runner.pos_keep_exit_distance = sample_exit_distance(runner);
        }
    } else if behind < runner.pos_keep_min_threshold
        && runner.target_speed_skills_active.is_empty()
        && runner.current_speed_skills_active.is_empty()
    {
        begin_state(runner, PositionKeepState::PaceDown);
        runner.pos_keep_exit_distance = sample_exit_distance(runner);
    }
}

fn sample_exit_distance(runner: &mut Runner) -> f64 {
    // Global post-1.5: mid-race Pace Down rolls only through the midpoint of the
    // min/max threshold window. Other states/phases keep the full range.
    let max_threshold = if runner.position_keep_state == PositionKeepState::PaceDown
        && runner.phase == Phase::MidRace
    {
        runner.pos_keep_min_threshold
            + (runner.pos_keep_max_threshold - runner.pos_keep_min_threshold) * 0.5
    } else {
        runner.pos_keep_max_threshold
    };
    let span = max_threshold - runner.pos_keep_min_threshold;
    runner.pos_keep_rng.random() * span + runner.pos_keep_min_threshold
}

fn should_pace_up_ex(runner: &Runner, ctx: &PositionKeepContext) -> bool {
    if strategy_matches(runner.position_keep_strategy, Strategy::FrontRunner) {
        return ctx.backward_strategy_runner_ahead;
    }

    ctx.pacer_strategy
        .is_some_and(|pacer| pacer.order_rank() > runner.position_keep_strategy.order_rank())
}

fn handle_pace_up_ex_priority(runner: &mut Runner, ctx: &PositionKeepContext) -> bool {
    let should_enter = should_pace_up_ex(runner, ctx);
    if should_enter {
        if runner.position_keep_state != PositionKeepState::PaceUpEx {
            exit_position_keep(runner, None);
            begin_state(runner, PositionKeepState::PaceUpEx);
        }
        return true;
    }

    if runner.position_keep_state == PositionKeepState::PaceUpEx {
        exit_position_keep(runner, Some(-3.0));
        return true;
    }

    false
}

fn handle_none(runner: &mut Runner, ctx: &PositionKeepContext, behind: f64) {
    if runner.pos_keep_next_timer.t < 0.0 {
        return;
    }

    if strategy_matches(runner.position_keep_strategy, Strategy::FrontRunner) {
        enter_from_none_front_runner(runner, ctx);
    } else {
        enter_from_none_pacer(runner, behind);
    }

    if runner.position_keep_state == PositionKeepState::None {
        runner.pos_keep_next_timer.t = -2.0;
    } else {
        runner.pos_keep_exit_position = keep_exit_position(runner);
    }
}

fn handle_speed_up(runner: &mut Runner, ctx: &PositionKeepContext) {
    if runner.position >= runner.pos_keep_exit_position {
        exit_position_keep(runner, Some(-3.0));
        return;
    }
    if ctx.pacer_is_self {
        let Some(distance_ahead) = lead_over_second(runner, ctx) else {
            return;
        };
        let threshold = speed_up_lead_threshold(runner, ctx);
        if distance_ahead >= threshold {
            exit_position_keep(runner, Some(-3.0));
        }
    }
}

fn handle_overtake(runner: &mut Runner, ctx: &PositionKeepContext) {
    if runner.position >= runner.pos_keep_exit_position {
        exit_position_keep(runner, Some(-3.0));
        return;
    }
    if ctx.pacer_is_self {
        let Some(distance_ahead) = lead_over_second(runner, ctx) else {
            return;
        };
        let threshold = if runner.position_keep_strategy == Strategy::Runaway {
            27.5
        } else {
            10.0
        };
        if distance_ahead >= threshold {
            exit_position_keep(runner, Some(-3.0));
        }
    }
}

fn handle_pace_up(runner: &mut Runner, behind: f64) {
    if runner.position >= runner.pos_keep_exit_position || behind < runner.pos_keep_exit_distance {
        exit_position_keep(runner, Some(-3.0));
    }
}

fn handle_pace_down(runner: &mut Runner, behind: f64) {
    if runner.position >= runner.pos_keep_exit_position
        || behind > runner.pos_keep_exit_distance
        || !runner.target_speed_skills_active.is_empty()
        || !runner.current_speed_skills_active.is_empty()
    {
        exit_position_keep(runner, Some(-3.0));
    }
}

/// Advance the virtual position-keep state machine one step.
pub fn apply_virtual_position_keep(runner: &mut Runner, ctx: &PositionKeepContext) {
    if ctx.position_keep_mode != VIRTUAL_MODE || runner.position >= runner.pos_keep_end {
        exit_position_keep(runner, None);
        return;
    }

    if handle_pace_up_ex_priority(runner, ctx) {
        return;
    }

    let forced = forced_rank_behind(runner, ctx);
    let has_forced_rank = forced.is_some();

    if !has_forced_rank && (ctx.pacer_position.is_none() || ctx.num_runners < 2) {
        return;
    }

    let behind = forced.unwrap_or_else(|| {
        ctx.pacer_position
            .map_or(0.0, |pacer| pacer - runner.position)
    });

    match runner.position_keep_state {
        PositionKeepState::None => handle_none(runner, ctx, behind),
        PositionKeepState::SpeedUp => handle_speed_up(runner, ctx),
        PositionKeepState::Overtake => handle_overtake(runner, ctx),
        PositionKeepState::PaceUp => handle_pace_up(runner, behind),
        PositionKeepState::PaceDown => handle_pace_down(runner, behind),
        PositionKeepState::PaceUpEx => unreachable!("PaceUpEx is handled by priority gate"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runner::test_support::test_runner;

    fn runner(strategy: Strategy, position: f64) -> Runner {
        let mut r = test_runner(0, strategy);
        r.position = position;
        r.section_length = 100.0;
        r
    }

    fn ctx(
        pacer_position: Option<f64>,
        pacer_is_self: bool,
        second: Option<f64>,
    ) -> PositionKeepContext {
        PositionKeepContext {
            position_keep_mode: VIRTUAL_MODE,
            num_runners: 9,
            field_size: 9,
            pacer_position,
            pacer_strategy: Some(Strategy::FrontRunner),
            pacer_is_self,
            second_place_position: second,
            backward_strategy_runner_ahead: false,
            only_front_runner: false,
        }
    }

    #[test]
    fn coefficient_matches_state() {
        let mut r = runner(Strategy::PaceChaser, 100.0);
        r.position_keep_state = PositionKeepState::PaceDown;
        update_position_keep_coefficient(&mut r);
        assert_eq!(r.pos_keep_speed_coef, 0.915);
        r.phase = Phase::MidRace;
        update_position_keep_coefficient(&mut r);
        assert_eq!(r.pos_keep_speed_coef, 0.945);
        r.position_keep_state = PositionKeepState::PaceUpEx;
        update_position_keep_coefficient(&mut r);
        assert_eq!(r.pos_keep_speed_coef, 2.0);
        r.position_keep_state = PositionKeepState::Overtake;
        update_position_keep_coefficient(&mut r);
        assert_eq!(r.pos_keep_speed_coef, 1.05);
    }

    #[test]
    fn pos_keep_end_scales_with_multiplier() {
        assert_eq!(calculate_pos_keep_end(100.0, 10.0), 1000.0);
        assert_eq!(calculate_pos_keep_end(100.0, 3.0), 300.0);
    }

    #[test]
    fn initialize_sets_thresholds_and_end() {
        let mut r = runner(Strategy::PaceChaser, 0.0);
        initialize_position_keep(&mut r, 2400.0, 3.0);
        assert_eq!(r.position_keep_state, PositionKeepState::None);
        assert_eq!(r.pos_keep_end, 300.0);
        assert!(r.pos_keep_max_threshold > r.pos_keep_min_threshold);
    }

    #[test]
    fn exits_when_mode_is_not_virtual() {
        let mut r = runner(Strategy::PaceChaser, 50.0);
        r.position_keep_state = PositionKeepState::PaceUp;
        r.position_keep_activations.push(PositionKeepActivation {
            start: 10.0,
            end: 0.0,
            state: PositionKeepState::PaceUp,
        });
        let mut c = ctx(Some(60.0), false, None);
        c.position_keep_mode = 0;
        apply_virtual_position_keep(&mut r, &c);
        assert_eq!(r.position_keep_state, PositionKeepState::None);
        assert_eq!(r.position_keep_activations[0].end, 50.0);
    }

    #[test]
    fn pace_chaser_paces_up_when_too_far_behind() {
        let mut r = runner(Strategy::PaceChaser, 50.0);
        r.is_rushed = true; // force the wit check to pass deterministically
        initialize_position_keep(&mut r, 2400.0, 3.0);
        // Pacer far ahead -> behind exceeds max threshold.
        let c = ctx(Some(50.0 + r.pos_keep_max_threshold + 10.0), false, None);
        apply_virtual_position_keep(&mut r, &c);
        assert_eq!(r.position_keep_state, PositionKeepState::PaceUp);
        assert_eq!(r.position_keep_activations.len(), 1);
        assert!(r.pos_keep_exit_position > r.position);
    }

    #[test]
    fn pace_chaser_paces_down_when_too_close() {
        let mut r = runner(Strategy::PaceChaser, 50.0);
        r.is_rushed = true;
        initialize_position_keep(&mut r, 2400.0, 3.0);
        // Pacer barely ahead -> behind below min threshold, no active speed skills.
        let c = ctx(Some(50.0 + r.pos_keep_min_threshold - 0.5), false, None);
        apply_virtual_position_keep(&mut r, &c);
        assert_eq!(r.position_keep_state, PositionKeepState::PaceDown);
    }

    #[test]
    fn no_pacer_and_no_forced_rank_is_noop() {
        let mut r = runner(Strategy::PaceChaser, 50.0);
        initialize_position_keep(&mut r, 2400.0, 3.0);
        let c = ctx(None, false, None);
        apply_virtual_position_keep(&mut r, &c);
        assert_eq!(r.position_keep_state, PositionKeepState::None);
    }

    #[test]
    fn pace_up_exits_when_caught_up() {
        let mut r = runner(Strategy::PaceChaser, 50.0);
        initialize_position_keep(&mut r, 2400.0, 3.0);
        r.position_keep_state = PositionKeepState::PaceUp;
        r.pos_keep_exit_position = 1000.0;
        r.pos_keep_exit_distance = 5.0;
        r.position_keep_activations.push(PositionKeepActivation {
            start: 20.0,
            end: 0.0,
            state: PositionKeepState::PaceUp,
        });
        // behind (4) < exit_distance (5) -> exit.
        let c = ctx(Some(54.0), false, None);
        apply_virtual_position_keep(&mut r, &c);
        assert_eq!(r.position_keep_state, PositionKeepState::None);
        assert_eq!(r.pos_keep_next_timer.t, -3.0);
        assert_eq!(r.position_keep_activations[0].end, 50.0);
    }

    #[test]
    fn front_runner_pacer_speeds_up_when_lead_is_small() {
        let mut r = runner(Strategy::FrontRunner, 200.0);
        r.is_rushed = true;
        initialize_position_keep(&mut r, 2400.0, 3.0);
        // Self is pacer; second place only 3m behind (< 4.5 threshold).
        let c = ctx(Some(200.0), true, Some(197.0));
        apply_virtual_position_keep(&mut r, &c);
        assert_eq!(r.position_keep_state, PositionKeepState::SpeedUp);
    }

    #[test]
    fn solo_front_runner_uses_12_5m_speed_up_threshold() {
        // 10m lead: above 4.5 (multi-FR) but below 12.5 (solo) → SpeedUp only when solo.
        let mut multi_r = runner(Strategy::FrontRunner, 200.0);
        multi_r.is_rushed = true;
        initialize_position_keep(&mut multi_r, 2400.0, 3.0);
        let mut multi = ctx(Some(200.0), true, Some(190.0));
        multi.only_front_runner = false;
        apply_virtual_position_keep(&mut multi_r, &multi);
        assert_eq!(multi_r.position_keep_state, PositionKeepState::None);

        let mut solo_r = runner(Strategy::FrontRunner, 200.0);
        solo_r.is_rushed = true;
        initialize_position_keep(&mut solo_r, 2400.0, 3.0);
        let mut solo = ctx(Some(200.0), true, Some(190.0));
        solo.only_front_runner = true;
        apply_virtual_position_keep(&mut solo_r, &solo);
        assert_eq!(solo_r.position_keep_state, PositionKeepState::SpeedUp);
    }

    #[test]
    fn front_runner_enters_pace_up_ex_when_backline_runner_is_ahead() {
        let mut r = runner(Strategy::FrontRunner, 200.0);
        initialize_position_keep(&mut r, 2400.0, 3.0);
        let mut c = ctx(Some(190.0), false, Some(190.0));
        c.backward_strategy_runner_ahead = true;

        apply_virtual_position_keep(&mut r, &c);

        assert_eq!(r.position_keep_state, PositionKeepState::PaceUpEx);
        assert_eq!(
            r.position_keep_activations[0].state,
            PositionKeepState::PaceUpEx
        );
    }

    #[test]
    fn non_front_runner_enters_pace_up_ex_when_pacer_strategy_should_be_behind() {
        let mut r = runner(Strategy::PaceChaser, 200.0);
        initialize_position_keep(&mut r, 2400.0, 3.0);
        let mut c = ctx(Some(250.0), false, None);
        c.pacer_strategy = Some(Strategy::LateSurger);

        apply_virtual_position_keep(&mut r, &c);

        assert_eq!(r.position_keep_state, PositionKeepState::PaceUpEx);
    }

    #[test]
    fn pace_up_ex_exits_when_entry_condition_stops_holding() {
        let mut r = runner(Strategy::PaceChaser, 200.0);
        initialize_position_keep(&mut r, 2400.0, 3.0);
        r.position_keep_state = PositionKeepState::PaceUpEx;
        r.position_keep_activations.push(PositionKeepActivation {
            start: 100.0,
            end: 0.0,
            state: PositionKeepState::PaceUpEx,
        });
        let c = ctx(Some(250.0), false, None);

        apply_virtual_position_keep(&mut r, &c);

        assert_eq!(r.position_keep_state, PositionKeepState::None);
        assert_eq!(r.pos_keep_next_timer.t, -3.0);
        assert_eq!(r.position_keep_activations[0].end, 200.0);
    }
}
