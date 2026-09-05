//! The game's own per-race result record, projected from the event stream.
//!
//! [`RaceReplay`] mirrors `RaceSimulateData`, the struct the game writes into a
//! race capture and that replay viewers (Hakuraku) read back. Emitting it from
//! the engine means a simulated round and a captured race share one shape: a
//! downstream can diff them, and analysis written against captures runs
//! unchanged over simulated rounds.
//!
//! The layout, in the game's units, transcribed from the capture format:
//!
//! - a frame at the gate (time 0) and one per tick: raw seconds, then per gate `distance` (m),
//!   `lane_position` (10000 per course width, so gate k stands at k/18 of it), `speed` (m/s × 100),
//!   `hp`, `temptation_mode`, `block_front_horse_index`
//! - a result per gate: 0-based finish order, scaled finish time, scaled gap to
//!   the runner one place ahead, start delay, 0-based guts and wit ranks, spurt
//!   start distance, running style, raw finish time
//! - point events: skill activations as
//!   `[gate, skill_id, -1, 0, target_bitmask, 0]`
//!
//! Serialization (the packed binary, gzip, base64) is not this crate's job; a
//! downstream owns the bytes. This projection owns the values.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;

use uma_sim_primitives::events::{RaceObservation, RaceObserver, RunnerObservation};
use uma_sim_primitives::shared_kernel::ids::{RunnerId, SkillId};
use uma_sim_primitives::shared_kernel::language::Strategy;

/// Ticks per simulated second; matches the aggregate frame rate.
const TICKS_PER_SECOND: f64 = 15.0;
/// Displayed race time is the raw time scaled (`docs/mechanics/README.md`,
/// "DisplayedTime = ActualTime * 1.18").
const DISPLAY_TIME_SCALE: f64 = 1.18;
/// `lane_position` units per course width. The game places gate k at
/// `k / 18` of the width, which is `k * 555` in these units.
const LANE_UNITS_PER_COURSE_WIDTH: f64 = 10000.0;
/// `SimulateEventType.SKILL`.
const EVENT_SKILL: i8 = 3;
/// `block_front_horse_index` when nothing is in front.
const NO_BLOCKER: i8 = -1;

/// `TemptationMode` as the game names it. A rushed runner is tagged by the
/// style it is rushing in; the game has no oikomi variant, so end closers
/// share the sashi one.
fn temptation_mode(rushed: bool, running_style: i64) -> i8 {
    if !rushed {
        return 0;
    }
    match running_style {
        s if s == Strategy::FrontRunner as i64 || s == Strategy::Runaway as i64 => 3,
        s if s == Strategy::PaceChaser as i64 => 2,
        _ => 1,
    }
}

/// One gate's sample within a frame.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct ReplayHorseFrame {
    /// Meters from the start.
    pub distance: f32,
    /// 0 at the inner rail, 10000 one course width out; can exceed 10000.
    pub lane_position: u16,
    /// Meters per second, times 100.
    pub speed: u16,
    /// Remaining HP.
    pub hp: u16,
    /// 0 when calm; the rushed style otherwise.
    pub temptation_mode: i8,
    /// Gate index of the runner blocking in front, or -1.
    pub block_front_horse_index: i8,
}

/// One tick of the race, every gate sampled.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ReplayFrame {
    /// Raw seconds since the gates opened.
    pub time: f32,
    /// One per gate, in gate order.
    pub horses: Vec<ReplayHorseFrame>,
}

/// One gate's result row.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct ReplayHorseResult {
    /// 0 is the winner.
    pub finish_order: i32,
    /// Displayed (scaled) finish time.
    pub finish_time: f32,
    /// Displayed gap to the runner one place ahead; 0 for the winner.
    pub finish_diff_time: f32,
    /// Seconds lost at the gate.
    pub start_delay_time: f32,
    /// 0-based rank of this gate's guts in the field.
    pub guts_order: u8,
    /// 0-based rank of this gate's wit in the field.
    pub wiz_order: u8,
    /// Where the last spurt began; 0 when it never did.
    pub last_spurt_start_distance: f32,
    /// NIGE 1, SENKO 2, SASHI 3, OIKOMI 4.
    pub running_style: u8,
    /// Carried for shape parity; the engine has no source for it.
    pub defeat: i32,
    /// Raw finish time in seconds.
    pub finish_time_raw: f32,
}

/// A point event.
#[derive(Debug, Clone, PartialEq)]
pub struct ReplayEvent {
    /// Raw seconds since the gates opened.
    pub frame_time: f32,
    /// `SimulateEventType` discriminant.
    pub kind: i8,
    /// Event-specific parameters.
    pub params: Vec<i32>,
}

/// One round in the game's result shape.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RaceReplay {
    /// Widest leader-to-tail gap seen in any frame, in meters.
    pub distance_diff_max: f32,
    /// Every tick, in order.
    pub frames: Vec<ReplayFrame>,
    /// One per gate, in gate order.
    pub results: Vec<ReplayHorseResult>,
    /// Chronological.
    pub events: Vec<ReplayEvent>,
}

/// What the collector remembers about a gate between ticks.
#[derive(Debug, Clone, Default)]
struct GateState {
    last_frame: ReplayHorseFrame,
    guts: i64,
    wit: i64,
    running_style: i64,
    start_delay: f64,
    last_spurt_start: Option<f64>,
    seen_skills: HashSet<String>,
    finish_order: Option<i32>,
    finish_time_raw: f64,
}

#[derive(Default)]
struct ReplayInner {
    rounds: Vec<RaceReplay>,
    current: RaceReplay,
    gates: Vec<GateState>,
    /// Finish times in finishing order, for the gap to the runner ahead.
    finish_times: Vec<f64>,
    /// Applied debuff targets keyed by caster and skill until its point event is written.
    target_masks: HashMap<(RunnerId, String), i32>,
}

impl ReplayInner {
    /// Frame index for the current race time. Frame 0 is the gate, so the
    /// first tick lands in frame 1, as in the game's own capture.
    fn tick_of(&self, race: &dyn RaceObservation) -> usize {
        (race.accumulated_time() * TICKS_PER_SECOND)
            .round()
            .max(0.0) as usize
    }

    /// Record `runner`'s state into the frame for `race`'s current time and
    /// remember the per-gate fields the result row needs.
    fn record(&mut self, race: &dyn RaceObservation, runner: &dyn RunnerObservation) {
        let gate = runner.id().0 as usize;
        let tick = self.tick_of(race);
        let time = race.accumulated_time();
        let position = runner.position().min(race.course_distance());
        let course_width = race.course_width();
        let running_style = runner.running_style();

        let sample = ReplayHorseFrame {
            distance: position as f32,
            lane_position: if course_width > 0.0 {
                (runner.current_lane() / course_width * LANE_UNITS_PER_COURSE_WIDTH)
                    .round()
                    .clamp(0.0, f64::from(u16::MAX)) as u16
            } else {
                0
            },
            speed: (runner.current_speed() * 100.0)
                .round()
                .clamp(0.0, f64::from(u16::MAX)) as u16,
            hp: runner
                .current_health()
                .round()
                .clamp(0.0, f64::from(u16::MAX)) as u16,
            temptation_mode: temptation_mode(runner.is_rushed(), running_style),
            block_front_horse_index: runner.front_blocker().map_or(NO_BLOCKER, |id| id.0 as i8),
        };

        let state = self.gate_mut(gate);
        state.last_frame = sample;
        state.guts = runner.guts_stat();
        state.wit = runner.wit_stat();
        state.running_style = running_style;
        state.start_delay = runner.start_delay();
        if state.last_spurt_start.is_none() && runner.is_last_spurt() {
            state.last_spurt_start = Some(position);
        }

        let frame = self.frame_mut(tick, time);
        if frame.horses.len() <= gate {
            frame
                .horses
                .resize_with(gate + 1, ReplayHorseFrame::default);
        }
        frame.horses[gate] = sample;
    }

    /// The gate's state, growing the field the first time a gate is seen. A
    /// gate is a runner's insertion index, so ids arrive dense from zero.
    fn gate_mut(&mut self, gate: usize) -> &mut GateState {
        if self.gates.len() <= gate {
            self.gates.resize_with(gate + 1, GateState::default);
        }
        &mut self.gates[gate]
    }

    /// The frame for `tick`, creating it and any missing ones before it. A
    /// new frame starts as a copy of each gate's last sample, so a runner
    /// that has finished and stopped ticking still appears at the line.
    fn frame_mut(&mut self, tick: usize, time: f64) -> &mut ReplayFrame {
        while self.current.frames.len() <= tick {
            let horses = self.gates.iter().map(|g| g.last_frame).collect();
            self.current.frames.push(ReplayFrame {
                time: time as f32,
                horses,
            });
        }
        &mut self.current.frames[tick]
    }
}

/// Projects each round into a [`RaceReplay`].
///
/// Attach [`handle`](Self::handle) as a [`RaceObserver`], run the rounds, then
/// read [`result`](Self::result).
pub struct RaceReplayCollector {
    inner: Rc<RefCell<ReplayInner>>,
}

impl Default for RaceReplayCollector {
    fn default() -> Self {
        Self::new()
    }
}

impl RaceReplayCollector {
    /// A fresh collector.
    pub fn new() -> Self {
        RaceReplayCollector {
            inner: Rc::new(RefCell::new(ReplayInner::default())),
        }
    }

    /// A boxed observer sharing this collector's storage.
    pub fn handle(&self) -> Box<dyn RaceObserver> {
        Box::new(ReplayObserver {
            inner: Rc::clone(&self.inner),
        })
    }

    /// One replay per completed round.
    pub fn result(&self) -> Vec<RaceReplay> {
        self.inner.borrow().rounds.clone()
    }
}

struct ReplayObserver {
    inner: Rc<RefCell<ReplayInner>>,
}

impl RaceObserver for ReplayObserver {
    fn on_round_start(&mut self, _race: &dyn RaceObservation, _seed: u64) {
        let mut inner = self.inner.borrow_mut();
        inner.current = RaceReplay::default();
        inner.gates.clear();
        inner.finish_times.clear();
        inner.target_masks.clear();
    }

    fn on_debuff_routed(&mut self, source: RunnerId, target: RunnerId, skill_id: &SkillId) {
        let target_bit = 1_i32 << target.0;
        let mut inner = self.inner.borrow_mut();
        *inner
            .target_masks
            .entry((source, skill_id.0.clone()))
            .or_default() |= target_bit;
    }

    fn on_runner_prepared(&mut self, race: &dyn RaceObservation, runner: &dyn RunnerObservation) {
        self.inner.borrow_mut().record(race, runner);
    }

    fn on_after_runner_tick(
        &mut self,
        race: &dyn RaceObservation,
        runner: &dyn RunnerObservation,
        _dt: f64,
    ) {
        let mut inner = self.inner.borrow_mut();
        inner.record(race, runner);
        let gate = runner.id().0 as usize;
        let time = race.accumulated_time();
        let newly_used: Vec<String> = {
            let state = inner.gate_mut(gate);
            runner
                .used_skills()
                .into_iter()
                .filter(|id| state.seen_skills.insert((*id).to_owned()))
                .map(str::to_owned)
                .collect()
        };

        for skill_id in newly_used {
            let target_mask = inner
                .target_masks
                .remove(&(runner.id(), skill_id.clone()))
                .unwrap_or(0);
            // A skill the engine names outside the game's numeric space has no
            // id a replay viewer could resolve; it is left out of the replay.
            let Ok(numeric) = skill_id.parse::<i32>() else {
                continue;
            };
            inner.current.events.push(ReplayEvent {
                frame_time: time as f32,
                kind: EVENT_SKILL,
                params: vec![gate as i32, numeric, -1, 0, target_mask, 0],
            });
        }
    }

    fn on_runner_finished(&mut self, _race: &dyn RaceObservation, runner: &dyn RunnerObservation) {
        let mut inner = self.inner.borrow_mut();
        let gate = runner.id().0 as usize;
        let order = inner.finish_times.len() as i32;
        inner.finish_times.push(runner.finish_time());
        let state = inner.gate_mut(gate);
        state.finish_order = Some(order);
        state.finish_time_raw = runner.finish_time();
    }

    fn on_round_end(&mut self, _race: &dyn RaceObservation) {
        let mut inner = self.inner.borrow_mut();
        let gate_count = inner.gates.len();

        // Every frame carries every gate once the field is known.
        for frame in &mut inner.current.frames {
            frame
                .horses
                .resize_with(gate_count, ReplayHorseFrame::default);
        }

        inner.current.distance_diff_max = inner
            .current
            .frames
            .iter()
            .map(|frame| {
                let (min, max) = frame
                    .horses
                    .iter()
                    .fold((f32::INFINITY, f32::NEG_INFINITY), |(min, max), horse| {
                        (min.min(horse.distance), max.max(horse.distance))
                    });
                if frame.horses.is_empty() {
                    0.0
                } else {
                    max - min
                }
            })
            .fold(0.0, f32::max);

        let guts: Vec<i64> = inner.gates.iter().map(|g| g.guts).collect();
        let wit: Vec<i64> = inner.gates.iter().map(|g| g.wit).collect();
        let finish_times = inner.finish_times.clone();

        inner.current.results = inner
            .gates
            .iter()
            .enumerate()
            .map(|(gate, state)| {
                // A runner that never crossed the line takes the last place.
                let order = state
                    .finish_order
                    .unwrap_or(gate_count.saturating_sub(1) as i32);
                let ahead = (order > 0)
                    .then(|| finish_times.get(order as usize - 1).copied())
                    .flatten();
                let raw = state.finish_time_raw;
                ReplayHorseResult {
                    finish_order: order,
                    finish_time: (raw * DISPLAY_TIME_SCALE) as f32,
                    finish_diff_time: ahead
                        .map_or(0.0, |ahead| ((raw - ahead) * DISPLAY_TIME_SCALE) as f32),
                    start_delay_time: state.start_delay as f32,
                    guts_order: rank_desc(&guts, gate),
                    wiz_order: rank_desc(&wit, gate),
                    last_spurt_start_distance: state.last_spurt_start.unwrap_or(0.0) as f32,
                    running_style: base_style(state.running_style),
                    defeat: 0,
                    finish_time_raw: raw as f32,
                }
            })
            .collect();

        inner
            .current
            .events
            .sort_by(|a, b| a.frame_time.total_cmp(&b.frame_time));

        let round = std::mem::take(&mut inner.current);
        inner.rounds.push(round);
    }
}

/// 0-based rank of `values[index]`, highest first, ties broken by gate order.
fn rank_desc(values: &[i64], index: usize) -> u8 {
    values
        .iter()
        .enumerate()
        .filter(|&(other, &value)| {
            value > values[index] || (value == values[index] && other < index)
        })
        .count()
        .min(usize::from(u8::MAX)) as u8
}

/// The replay format has no Runaway; it reads as a front runner there.
fn base_style(running_style: i64) -> u8 {
    if running_style == Strategy::Runaway as i64 {
        Strategy::FrontRunner as u8
    } else {
        running_style.clamp(0, i64::from(u8::MAX)) as u8
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uma_sim_primitives::shared_kernel::ids::RunnerId;

    struct TestRace {
        time: f64,
    }
    impl RaceObservation for TestRace {
        fn course_distance(&self) -> f64 {
            1600.0
        }
        fn accumulated_time(&self) -> f64 {
            self.time
        }
        fn max_lane_distance(&self) -> f64 {
            14.0625
        }
        fn course_width(&self) -> f64 {
            11.25
        }
    }

    #[derive(Default)]
    struct TestRunner {
        id: u32,
        pos: f64,
        speed: f64,
        lane: f64,
        hp: f64,
        guts: i64,
        wit: i64,
        style: i64,
        rushed: bool,
        last_spurt: bool,
        finish_time: f64,
        start_delay: f64,
        blocker: Option<u32>,
        used: Vec<String>,
    }
    impl RunnerObservation for TestRunner {
        fn id(&self) -> RunnerId {
            RunnerId(self.id)
        }
        fn position(&self) -> f64 {
            self.pos
        }
        fn current_speed(&self) -> f64 {
            self.speed
        }
        fn current_lane(&self) -> f64 {
            self.lane
        }
        fn current_health(&self) -> f64 {
            self.hp
        }
        fn guts_stat(&self) -> i64 {
            self.guts
        }
        fn wit_stat(&self) -> i64 {
            self.wit
        }
        fn running_style(&self) -> i64 {
            self.style
        }
        fn is_rushed(&self) -> bool {
            self.rushed
        }
        fn is_last_spurt(&self) -> bool {
            self.last_spurt
        }
        fn finish_time(&self) -> f64 {
            self.finish_time
        }
        fn start_delay(&self) -> f64 {
            self.start_delay
        }
        fn front_blocker(&self) -> Option<RunnerId> {
            self.blocker.map(RunnerId)
        }
        fn used_skills(&self) -> Vec<&str> {
            self.used.iter().map(String::as_str).collect()
        }
    }

    fn runner(id: u32, pos: f64) -> TestRunner {
        TestRunner {
            id,
            pos,
            speed: 20.0,
            hp: 1200.0,
            ..Default::default()
        }
    }

    /// One tick for every gate at `time`.
    fn tick(obs: &mut Box<dyn RaceObserver>, time: f64, runners: &[TestRunner]) {
        let race = TestRace { time };
        for r in runners {
            obs.on_after_runner_tick(&race, r, 1.0 / TICKS_PER_SECOND);
        }
    }

    #[test]
    fn frames_carry_every_gate_in_game_units() {
        let collector = RaceReplayCollector::new();
        let mut obs = collector.handle();
        let start = TestRace { time: 0.0 };
        obs.on_round_start(&start, 1);
        obs.on_runner_prepared(&start, &runner(0, 0.0));
        obs.on_runner_prepared(&start, &runner(1, 0.0));

        let mut a = runner(0, 10.0);
        a.speed = 18.63;
        a.lane = 7.03125;
        a.hp = 1180.4;
        a.blocker = Some(1);
        let b = runner(1, 12.0);
        tick(&mut obs, 1.0 / 15.0, &[a, b]);
        obs.on_round_end(&TestRace { time: 1.0 / 15.0 });

        let replay = &collector.result()[0];
        // Frame 0 is the gate; the first tick lands in frame 1.
        assert_eq!(replay.frames.len(), 2);
        let frame = &replay.frames[1];
        assert_eq!(frame.horses.len(), 2);
        assert_eq!(frame.horses[0].distance, 10.0);
        assert_eq!(frame.horses[0].speed, 1863);
        // 7.03125 m is 0.625 of an 11.25 m course width.
        assert_eq!(frame.horses[0].lane_position, 6250);
        assert_eq!(frame.horses[0].hp, 1180);
        assert_eq!(frame.horses[0].block_front_horse_index, 1);
        assert_eq!(frame.horses[1].block_front_horse_index, NO_BLOCKER);
        assert_eq!(replay.distance_diff_max, 2.0);
    }

    #[test]
    fn the_gate_frame_records_the_prepared_field_at_time_zero() {
        let collector = RaceReplayCollector::new();
        let mut obs = collector.handle();
        let start = TestRace { time: 0.0 };
        obs.on_round_start(&start, 1);
        let mut a = runner(0, 0.0);
        a.speed = 3.0;
        obs.on_runner_prepared(&start, &a);
        obs.on_runner_prepared(&start, &runner(1, 0.0));
        tick(&mut obs, 1.0 / 15.0, &[runner(0, 1.0), runner(1, 1.0)]);
        obs.on_round_end(&TestRace { time: 1.0 / 15.0 });

        let replay = &collector.result()[0];
        assert_eq!(replay.frames.len(), 2);
        assert_eq!(replay.frames[0].time, 0.0);
        assert_eq!(replay.frames[0].horses[0].speed, 300);
        assert_eq!(replay.frames[0].horses[1].distance, 0.0);
        assert_eq!(replay.frames[1].horses[0].distance, 1.0);
    }

    #[test]
    fn a_finished_runner_stays_at_the_line_in_later_frames() {
        let collector = RaceReplayCollector::new();
        let mut obs = collector.handle();
        obs.on_round_start(&TestRace { time: 0.0 }, 1);

        tick(
            &mut obs,
            1.0 / 15.0,
            &[runner(0, 1600.0), runner(1, 1590.0)],
        );
        obs.on_runner_finished(
            &TestRace { time: 1.0 / 15.0 },
            &TestRunner {
                finish_time: 74.0,
                ..runner(0, 1600.0)
            },
        );
        // Gate 0 no longer ticks.
        tick(&mut obs, 2.0 / 15.0, &[runner(1, 1600.0)]);
        obs.on_round_end(&TestRace { time: 2.0 / 15.0 });

        let replay = &collector.result()[0];
        assert_eq!(replay.frames.len(), 3);
        assert_eq!(replay.frames[2].horses[0].distance, 1600.0);
        assert_eq!(replay.frames[2].horses[1].distance, 1600.0);
    }

    #[test]
    fn results_rank_the_field_and_scale_only_the_displayed_times() {
        let collector = RaceReplayCollector::new();
        let mut obs = collector.handle();
        obs.on_round_start(&TestRace { time: 0.0 }, 1);

        let mut fast = runner(0, 0.0);
        fast.guts = 600;
        fast.wit = 900;
        fast.style = Strategy::Runaway as i64;
        fast.start_delay = 0.07;
        let mut slow = runner(1, 0.0);
        slow.guts = 800;
        slow.wit = 700;
        slow.style = Strategy::EndCloser as i64;
        tick(&mut obs, 1.0 / 15.0, &[fast, slow]);

        let race = TestRace { time: 75.0 };
        obs.on_runner_finished(
            &race,
            &TestRunner {
                finish_time: 74.0,
                ..runner(0, 1600.0)
            },
        );
        obs.on_runner_finished(
            &race,
            &TestRunner {
                finish_time: 74.5,
                ..runner(1, 1600.0)
            },
        );
        obs.on_round_end(&race);

        let replay = &collector.result()[0];
        let [winner, second] = replay.results.as_slice() else {
            panic!("two results");
        };
        assert_eq!(winner.finish_order, 0);
        assert_eq!(second.finish_order, 1);
        assert_eq!(winner.finish_time_raw, 74.0);
        assert!((winner.finish_time - 74.0 * 1.18).abs() < 1e-4);
        assert_eq!(winner.finish_diff_time, 0.0);
        assert!((second.finish_diff_time - 0.5 * 1.18).abs() < 1e-4);
        assert!((winner.start_delay_time - 0.07).abs() < 1e-6);
        // Guts: slow has more, so slow is rank 0. Wit: fast has more.
        assert_eq!(winner.guts_order, 1);
        assert_eq!(second.guts_order, 0);
        assert_eq!(winner.wiz_order, 0);
        assert_eq!(second.wiz_order, 1);
        // Runaway reads as a front runner in the replay format.
        assert_eq!(winner.running_style, Strategy::FrontRunner as u8);
        assert_eq!(second.running_style, Strategy::EndCloser as u8);
    }

    #[test]
    fn last_spurt_start_is_the_first_position_the_flag_was_seen() {
        let collector = RaceReplayCollector::new();
        let mut obs = collector.handle();
        obs.on_round_start(&TestRace { time: 0.0 }, 1);

        tick(&mut obs, 1.0 / 15.0, &[runner(0, 1000.0)]);
        let mut spurting = runner(0, 1068.3);
        spurting.last_spurt = true;
        tick(&mut obs, 2.0 / 15.0, &[spurting]);
        let mut later = runner(0, 1200.0);
        later.last_spurt = true;
        tick(&mut obs, 3.0 / 15.0, &[later]);
        obs.on_round_end(&TestRace { time: 3.0 / 15.0 });

        let replay = &collector.result()[0];
        assert!((replay.results[0].last_spurt_start_distance - 1068.3).abs() < 1e-3);
    }

    #[test]
    fn a_never_spurting_runner_reads_as_no_marker() {
        let collector = RaceReplayCollector::new();
        let mut obs = collector.handle();
        obs.on_round_start(&TestRace { time: 0.0 }, 1);
        tick(&mut obs, 1.0 / 15.0, &[runner(0, 10.0)]);
        obs.on_round_end(&TestRace { time: 1.0 / 15.0 });

        assert_eq!(
            collector.result()[0].results[0].last_spurt_start_distance,
            0.0
        );
    }

    #[test]
    fn skill_activations_become_six_param_events_once_each() {
        let collector = RaceReplayCollector::new();
        let mut obs = collector.handle();
        obs.on_round_start(&TestRace { time: 0.0 }, 1);

        let mut r = runner(2, 10.0);
        r.used = vec!["200331".to_owned(), "not-a-game-id".to_owned()];
        obs.on_debuff_routed(RunnerId(2), RunnerId(0), &SkillId::new("200331"));
        obs.on_debuff_routed(RunnerId(2), RunnerId(4), &SkillId::new("200331"));
        tick(&mut obs, 1.0 / 15.0, &[r]);
        // The same skill is still in `used` next tick; it must not repeat.
        let mut again = runner(2, 20.0);
        again.used = vec!["200331".to_owned()];
        tick(&mut obs, 2.0 / 15.0, &[again]);
        obs.on_round_end(&TestRace { time: 2.0 / 15.0 });

        let events = &collector.result()[0].events;
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, EVENT_SKILL);
        assert_eq!(events[0].params, vec![2, 200_331, -1, 0, 0b1_0001, 0]);
        assert!((events[0].frame_time - 1.0 / 15.0).abs() < 1e-6);
    }

    #[test]
    fn a_rushed_runner_is_tagged_by_style() {
        assert_eq!(temptation_mode(false, Strategy::FrontRunner as i64), 0);
        assert_eq!(temptation_mode(true, Strategy::FrontRunner as i64), 3);
        assert_eq!(temptation_mode(true, Strategy::Runaway as i64), 3);
        assert_eq!(temptation_mode(true, Strategy::PaceChaser as i64), 2);
        assert_eq!(temptation_mode(true, Strategy::LateSurger as i64), 1);
        assert_eq!(temptation_mode(true, Strategy::EndCloser as i64), 1);
    }

    #[test]
    fn rounds_do_not_bleed_into_each_other() {
        let collector = RaceReplayCollector::new();
        let mut obs = collector.handle();

        obs.on_round_start(&TestRace { time: 0.0 }, 1);
        let mut r = runner(0, 10.0);
        r.used = vec!["200331".to_owned()];
        tick(&mut obs, 1.0 / 15.0, &[r]);
        obs.on_round_end(&TestRace { time: 1.0 / 15.0 });

        obs.on_round_start(&TestRace { time: 0.0 }, 2);
        let mut r = runner(0, 10.0);
        r.used = vec!["200331".to_owned()];
        tick(&mut obs, 1.0 / 15.0, &[r]);
        obs.on_round_end(&TestRace { time: 1.0 / 15.0 });

        let rounds = collector.result();
        assert_eq!(rounds.len(), 2);
        // The skill fires fresh in the second round rather than being "seen".
        assert_eq!(rounds[1].events.len(), 1);
        assert_eq!(rounds[1].frames.len(), 2);
    }
}
