//! Accuracy harness: replays captured game races through the engine and
//! scores the result against the game's own replay.
//!
//! Each fixture under `tests/fixtures/captures/` is one real race: the exact
//! `WasmRaceSimParams` the app would send (every runner pinned to its recorded
//! gate and start delay) plus the replay the server handed the client. A
//! downstream exports them with `pnpm run race:fixture` in torena-hub.
//!
//! Two runs per fixture, each over `ACCURACY_SAMPLES` seeds (default 8; raise
//! it when investigating one race, `ACCURACY_FIXTURE=<substring>` narrows the
//! set):
//!
//! - **free**: the engine rolls its own skill activations. Scores the whole
//!   model, randomness included, against one drawn outcome.
//! - **pinned**: skills the game fired are forced at the recorded distance,
//!   skills it never fired are removed, the last spurt starts where the game
//!   recorded it, rushed spells run where the game recorded them, and downhill
//!   mode runs where the recorded HP drain shows it. What is left is the
//!   deterministic part (speed, acceleration, HP) plus the rolls the replay
//!   does not record (section variance, dueling).
//!
//! `ACCURACY_TRACE=<gate>` prints every recorded frame for that gate against
//! the mean pinned simulation, for reading one runner's race line by line.
//!
//! This is a local harness, not a CI gate: the test is `#[ignore]`d so
//! `cargo test --workspace` skips it, and `-- --ignored` runs it. The scores
//! print with `--nocapture` and gate against `baseline.json`; run with
//! `UPDATE_ACCURACY_BASELINE=1` to accept a new baseline after a change that
//! is meant to move them.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use honse_sim::contested::replay::RaceReplay;
use honse_sim::contested::{run_race_sim, RaceSimResult};
use serde::{Deserialize, Serialize};
use uma_sim_wasm::dto::{WasmForcedRegion, WasmRaceSimParams};

const TICK_SECONDS: f64 = 1.0 / 15.0;
/// `SimulateEventType.SKILL` in both the game replay and `RaceReplay`.
const EVENT_SKILL: i8 = 3;
const DEFAULT_SAMPLES: usize = 8;
/// Slack on the regression gate, so float noise across platforms never trips it.
const FINISH_TIME_TOLERANCE: f64 = 0.02;
const TRAJECTORY_TOLERANCE: f64 = 0.25;
const SPEED_TOLERANCE: f64 = 0.02;
const HP_TOLERANCE: f64 = 2.0;

// ---------- fixture shape (mirrors torena-hub `export-sim-fixture.ts`) ----------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    source: Source,
    params: WasmRaceSimParams,
    horses: Vec<FixtureHorse>,
    observed: Observed,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Source {
    file: String,
    course_id: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureHorse {
    name: String,
    dropped_skill_ids: Vec<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Observed {
    frames: Vec<ObservedFrame>,
    results: Vec<ObservedResult>,
    events: Vec<ObservedEvent>,
}

/// One recorded frame, columnar per gate: meters, centimeters per second, HP.
#[derive(Deserialize)]
struct ObservedFrame {
    time: f64,
    distance: Vec<f64>,
    speed: Vec<f64>,
    hp: Vec<f64>,
    /// `temptationMode` per gate: 0 calm, otherwise rushing. Absent in older fixtures.
    #[serde(default)]
    rushed: Vec<i64>,
    /// Gate blocking each runner in front, or -1. Absent in older fixtures.
    #[serde(default)]
    blocker: Vec<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ObservedResult {
    finish_order: i32,
    finish_time_raw: f64,
    last_spurt_start_distance: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ObservedEvent {
    frame_time: f64,
    #[serde(rename = "type")]
    kind: i8,
    params: Vec<i64>,
}

// ---------- scores ----------

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Scores {
    /// Mean over runners of |mean simulated raw finish time - observed|, seconds.
    finish_time_mae: f64,
    /// Mean over runners of (mean simulated - observed) raw finish time; negative = engine too fast.
    finish_time_bias: f64,
    /// Fraction of rounds whose winner is the observed winner.
    winner_hit_rate: f64,
    /// Mean Spearman correlation between simulated and observed finish order.
    order_spearman: f64,
    /// Mean over runners of |mean simulated spurt start - observed|, meters.
    spurt_start_mae: f64,
    /// Mean over (runner, skill) of |simulated activation rate - observed fired (0/1)|.
    skill_activation_error: f64,
    /// Mean over (observed frame, runner) of |mean simulated distance - observed|, meters.
    trajectory_mae: f64,
    /// Mean over (observed frame, runner) of |mean simulated speed - observed|, m/s.
    #[serde(default)]
    speed_mae: f64,
    /// Mean over (observed frame, runner) of (mean simulated speed - observed), m/s.
    #[serde(default)]
    speed_bias: f64,
    /// Mean over (observed frame, runner) of |mean simulated HP - observed|.
    #[serde(default)]
    hp_mae: f64,
    /// Mean over (observed frame, runner) of (mean simulated HP - observed); negative = engine drains more.
    #[serde(default)]
    hp_bias: f64,
    /// Mean over (observed frame, runner) of agreement between the simulated
    /// rushed rate and the recorded rushed flag (1 = identical).
    #[serde(default)]
    rushed_agreement: f64,
}

/// One runner's state in one frame, in engine units.
#[derive(Debug, Clone, Copy, Default)]
struct FrameSample {
    /// Meters.
    distance: f64,
    /// Meters per second.
    speed: f64,
    hp: f64,
    /// 1 when rushed; averaged over rounds it is the rushed rate.
    rushed: f64,
    /// 1 when a runner in front blocks this one; averaged it is the blocked rate.
    blocked: f64,
}

/// Running comparison of mean simulated samples against recorded ones.
#[derive(Debug, Default, Clone, Copy)]
struct FrameErrors {
    distance_abs: f64,
    speed_abs: f64,
    speed_signed: f64,
    hp_abs: f64,
    hp_signed: f64,
    rushed_agreement: f64,
    blocked_sim: f64,
    blocked_observed: f64,
    count: usize,
}

impl FrameErrors {
    fn add(&mut self, sim: FrameSample, observed: FrameSample) {
        self.distance_abs += (sim.distance - observed.distance).abs();
        self.speed_abs += (sim.speed - observed.speed).abs();
        self.speed_signed += sim.speed - observed.speed;
        self.hp_abs += (sim.hp - observed.hp).abs();
        self.hp_signed += sim.hp - observed.hp;
        self.rushed_agreement += 1.0 - (sim.rushed - observed.rushed).abs();
        self.blocked_sim += sim.blocked;
        self.blocked_observed += observed.blocked;
        self.count += 1;
    }

    fn mean(&self, sum: f64) -> f64 {
        sum / self.count.max(1) as f64
    }
}

/// The game's three race phases, by fraction of the course covered.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    Early,
    Mid,
    Late,
}

impl Phase {
    const ALL: [Phase; 3] = [Phase::Early, Phase::Mid, Phase::Late];

    fn of(distance: f64, course_distance: f64) -> Phase {
        let fraction = distance / course_distance;
        if fraction < 1.0 / 6.0 {
            Phase::Early
        } else if fraction < 2.0 / 3.0 {
            Phase::Mid
        } else {
            Phase::Late
        }
    }
}

/// One accumulator per (runner) across rounds.
#[derive(Default)]
struct RunnerAccumulator {
    finish_time_sum: f64,
    spurt_start_sum: f64,
    fired: HashMap<i64, usize>,
}

fn fixture_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/captures")
}

/// `ACCURACY_FIXTURE=<substring>` narrows a run to matching fixture files.
fn load_fixtures() -> Vec<Fixture> {
    let only = std::env::var("ACCURACY_FIXTURE").unwrap_or_default();
    let mut paths: Vec<PathBuf> = fs::read_dir(fixture_dir())
        .expect("fixture directory")
        .map(|entry| entry.expect("dir entry").path())
        .filter(|path| {
            path.extension().is_some_and(|ext| ext == "json")
                && path.file_name().is_some_and(|name| name != "baseline.json")
                && path.to_string_lossy().contains(&only)
        })
        .collect();
    paths.sort();
    paths
        .iter()
        .map(|path| {
            let text = fs::read_to_string(path).expect("read fixture");
            serde_json::from_str(&text).unwrap_or_else(|e| panic!("parse {}: {e}", path.display()))
        })
        .collect()
}

fn samples() -> usize {
    std::env::var("ACCURACY_SAMPLES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_SAMPLES)
}

/// Observed skill activations per runner: skill id -> distance at which it fired.
fn observed_activations(observed: &Observed) -> Vec<HashMap<i64, f64>> {
    let mut per_runner: Vec<HashMap<i64, f64>> = vec![HashMap::new(); observed.results.len()];
    for event in observed.events.iter().filter(|e| e.kind == EVENT_SKILL) {
        let (Some(&gate), Some(&skill_id)) = (event.params.first(), event.params.get(1)) else {
            continue;
        };
        let gate = gate as usize;
        let distance = observed_distance_at(observed, gate, event.frame_time);
        per_runner[gate].entry(skill_id).or_insert(distance);
    }
    per_runner
}

/// Linear interpolation of a runner's recorded distance at `time`.
fn observed_distance_at(observed: &Observed, gate: usize, time: f64) -> f64 {
    let frames = &observed.frames;
    let after = frames.partition_point(|f| f.time < time);
    match (
        after.checked_sub(1).and_then(|i| frames.get(i)),
        frames.get(after),
    ) {
        (None, Some(next)) => next.distance[gate],
        (Some(prev), None) => prev.distance[gate],
        (Some(prev), Some(next)) => {
            let span = next.time - prev.time;
            let t = if span > 0.0 {
                (time - prev.time) / span
            } else {
                0.0
            };
            prev.distance[gate] + t * (next.distance[gate] - prev.distance[gate])
        }
        (None, None) => 0.0,
    }
}

/// Contiguous recorded rushed spells per gate, as `[start, end)` distances.
/// A spell that is still running in the last recorded frame ends there.
fn observed_rushed_regions(observed: &Observed) -> Vec<Vec<WasmForcedRegion>> {
    let runners = observed.results.len();
    let mut regions: Vec<Vec<WasmForcedRegion>> = vec![Vec::new(); runners];
    let mut open: Vec<Option<f64>> = vec![None; runners];
    for frame in &observed.frames {
        for gate in 0..runners {
            let rushed = frame.rushed.get(gate).is_some_and(|&mode| mode != 0);
            match (open[gate], rushed) {
                (None, true) => open[gate] = Some(frame.distance[gate]),
                (Some(start), false) => {
                    regions[gate].push(WasmForcedRegion {
                        start,
                        end: frame.distance[gate],
                    });
                    open[gate] = None;
                }
                _ => {}
            }
        }
    }
    if let Some(last) = observed.frames.last() {
        for (gate, start) in open.into_iter().enumerate() {
            if let Some(start) = start {
                regions[gate].push(WasmForcedRegion {
                    start,
                    end: last.distance[gate].max(start + 1.0),
                });
            }
        }
    }
    regions
}

/// Documented HP drain per second at `speed`, before status modifiers.
fn documented_drain(speed: f64, course_distance: f64) -> f64 {
    let base_speed = 20.0 - (course_distance - 2000.0) / 1000.0;
    20.0 * (speed - base_speed + 12.0).powi(2) / 144.0
}

/// Downhill-mode spells per gate, read off the recorded HP drain.
///
/// The game never records the mode, but it records its effect: a one-second
/// sample on a downhill draining under half the documented rate (after the
/// guts multiplier from two-thirds on) is the mode's 0.4 factor and nothing
/// else. Pace-down is 0.6 and never gets that low. Rushed samples are skipped.
fn observed_downhill_regions(fixture: &Fixture) -> Vec<Vec<WasmForcedRegion>> {
    let observed = &fixture.observed;
    let course = &fixture.params.course;
    let on_downhill = |distance: f64| {
        course
            .slopes
            .iter()
            .any(|s| s.slope < 0.0 && distance >= s.start && distance < s.start + s.length)
    };
    let mood_coefficient = |mood: i32| 1.0 + f64::from(mood) * 0.02;
    let runners = observed.results.len();
    let mut regions: Vec<Vec<WasmForcedRegion>> = vec![Vec::new(); runners];
    for (gate, spells) in regions.iter_mut().enumerate() {
        let runner = &fixture.params.runners[gate];
        let guts = f64::from(runner.stats.guts) * mood_coefficient(runner.mood);
        let guts_modifier = 1.0 + 200.0 / (600.0 * guts).sqrt();
        let mut open: Option<f64> = None;
        for pair in observed.frames.windows(2) {
            let (a, b) = (&pair[0], &pair[1]);
            let dt = b.time - a.time;
            let (x0, x1) = (a.distance[gate], b.distance[gate]);
            let usable = dt >= 0.5
                && on_downhill(x0)
                && on_downhill(x1)
                && a.rushed.get(gate).is_none_or(|&m| m == 0)
                && b.rushed.get(gate).is_none_or(|&m| m == 0)
                && b.hp[gate] > 0.0;
            let mut in_mode = false;
            if usable {
                let speed = (a.speed[gate] + b.speed[gate]) / 200.0;
                let rate = (a.hp[gate] - b.hp[gate]) / dt;
                let mut expected = documented_drain(speed, course.distance);
                if (x0 + x1) / 2.0 >= course.distance * 2.0 / 3.0 {
                    expected *= guts_modifier;
                }
                in_mode = rate > 0.0 && rate / expected < 0.5;
            }
            match (open, in_mode) {
                (None, true) => open = Some(x0),
                (Some(start), false) if usable || !on_downhill(x1) => {
                    spells.push(WasmForcedRegion { start, end: x0 });
                    open = None;
                }
                _ => {}
            }
        }
        if let Some(start) = open {
            let end = observed
                .frames
                .last()
                .map_or(start + 1.0, |f| f.distance[gate]);
            spells.push(WasmForcedRegion {
                start,
                end: end.max(start + 1.0),
            });
        }
    }
    regions
}

/// Force the observed activations, drop every skill the game never fired,
/// start each last spurt where the game recorded it, and script the recorded
/// rushed and downhill spells in place of the engine's rolls.
fn pin_outcomes(params: &mut WasmRaceSimParams, observed: &Observed, fixture: &Fixture) {
    let activations = observed_activations(observed);
    let rushed = observed_rushed_regions(observed);
    let downhill = observed_downhill_regions(fixture);
    params.settings.rushed_runners = Some(vec![false; params.runners.len()]);
    params.settings.downhill_runners = Some(vec![false; params.runners.len()]);
    for ((((runner, fired), result), spells), descents) in params
        .runners
        .iter_mut()
        .zip(&activations)
        .zip(&observed.results)
        .zip(rushed)
        .zip(downhill)
    {
        runner.forced_rushed_regions = spells;
        runner.forced_downhill_regions = descents;
        runner.forced_last_spurt_distance =
            Some(result.last_spurt_start_distance).filter(|d| *d > 0.0);
        runner.skills.retain(|skill| {
            skill_base_id(&skill.skill_id).is_some_and(|id| fired.contains_key(&id))
        });
        runner.forced_positions = fired
            .iter()
            .map(|(id, distance)| (id.to_string(), *distance))
            .collect();
    }
}

fn skill_base_id(skill_id: &str) -> Option<i64> {
    skill_id.split('-').next()?.parse().ok()
}

fn run_full(params: &WasmRaceSimParams, nsamples: usize) -> RaceSimResult {
    let mut domain = params
        .clone()
        .into_domain()
        .expect("fixture params convert");
    domain.nsamples = nsamples;
    run_race_sim(domain).expect("race runs")
}

fn run(params: &WasmRaceSimParams, nsamples: usize) -> Vec<RaceReplay> {
    run_full(params, nsamples).replays
}

fn spearman(sim_order: &[i32], observed_order: &[i32]) -> f64 {
    let n = sim_order.len() as f64;
    let d2: f64 = sim_order
        .iter()
        .zip(observed_order)
        .map(|(a, b)| f64::from(a - b).powi(2))
        .sum();
    1.0 - 6.0 * d2 / (n * (n * n - 1.0))
}

/// The simulated sample nearest `time`, matched by frame time rather than
/// index: the engine's replay starts at the first tick while the game records
/// a frame at 0, so indexes are one tick apart. `None` once the replay ends.
fn sim_sample_at(replay: &RaceReplay, gate: usize, time: f64) -> Option<FrameSample> {
    let after = replay
        .frames
        .partition_point(|frame| f64::from(frame.time) < time);
    let candidates = [after.checked_sub(1), Some(after)];
    let index = candidates
        .into_iter()
        .flatten()
        .filter(|&i| i < replay.frames.len())
        .min_by(|&a, &b| {
            let da = (f64::from(replay.frames[a].time) - time).abs();
            let db = (f64::from(replay.frames[b].time) - time).abs();
            da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
        })
        .filter(|&i| (f64::from(replay.frames[i].time) - time).abs() <= TICK_SECONDS)?;
    replay.frames.get(index).map(|frame| {
        let horse = frame.horses[gate];
        FrameSample {
            distance: f64::from(horse.distance),
            speed: f64::from(horse.speed) / 100.0,
            hp: f64::from(horse.hp),
            rushed: if horse.temptation_mode != 0 { 1.0 } else { 0.0 },
            blocked: if horse.block_front_horse_index >= 0 {
                1.0
            } else {
                0.0
            },
        }
    })
}

fn observed_sample(frame: &ObservedFrame, gate: usize) -> FrameSample {
    FrameSample {
        distance: frame.distance[gate],
        speed: frame.speed[gate] / 100.0,
        hp: frame.hp[gate],
        rushed: if frame.rushed.get(gate).is_some_and(|&mode| mode != 0) {
            1.0
        } else {
            0.0
        },
        blocked: if frame.blocker.get(gate).is_some_and(|&b| b >= 0) {
            1.0
        } else {
            0.0
        },
    }
}

/// Mean simulated sample per (observed frame index, gate), over the rounds
/// still running at that frame.
fn mean_sim_samples(
    observed: &Observed,
    replays: &[RaceReplay],
) -> BTreeMap<(usize, usize), FrameSample> {
    let runners = observed.results.len();
    let mut sums: BTreeMap<(usize, usize), (FrameSample, usize)> = BTreeMap::new();
    for replay in replays {
        for (frame_index, frame) in observed.frames.iter().enumerate() {
            for gate in 0..runners {
                if let Some(sample) = sim_sample_at(replay, gate, frame.time) {
                    let slot = sums.entry((frame_index, gate)).or_default();
                    slot.0.distance += sample.distance;
                    slot.0.speed += sample.speed;
                    slot.0.hp += sample.hp;
                    slot.0.rushed += sample.rushed;
                    slot.0.blocked += sample.blocked;
                    slot.1 += 1;
                }
            }
        }
    }
    sums.into_iter()
        .map(|(key, (sum, count))| {
            let n = count as f64;
            (
                key,
                FrameSample {
                    distance: sum.distance / n,
                    speed: sum.speed / n,
                    hp: sum.hp / n,
                    rushed: sum.rushed / n,
                    blocked: sum.blocked / n,
                },
            )
        })
        .collect()
}

/// Frame errors over the recorded frames, optionally limited to one gate and
/// one phase (by the recorded distance).
fn frame_errors(
    fixture: &Fixture,
    means: &BTreeMap<(usize, usize), FrameSample>,
    gate: Option<usize>,
    phase: Option<Phase>,
) -> FrameErrors {
    let course_distance = fixture.params.course.distance;
    let mut errors = FrameErrors::default();
    for (&(frame_index, sample_gate), sim) in means {
        if gate.is_some_and(|g| g != sample_gate) {
            continue;
        }
        let observed = observed_sample(&fixture.observed.frames[frame_index], sample_gate);
        if phase.is_some_and(|p| p != Phase::of(observed.distance, course_distance)) {
            continue;
        }
        errors.add(*sim, observed);
    }
    errors
}

fn score(fixture: &Fixture, replays: &[RaceReplay], skills_per_runner: &[Vec<i64>]) -> Scores {
    let observed = &fixture.observed;
    let runners = observed.results.len();
    let rounds = replays.len() as f64;
    let observed_order: Vec<i32> = observed.results.iter().map(|r| r.finish_order).collect();
    let observed_winner = observed_order.iter().position(|&o| o == 0);
    let fired = observed_activations(observed);

    let mut acc: Vec<RunnerAccumulator> =
        (0..runners).map(|_| RunnerAccumulator::default()).collect();
    let mut winner_hits = 0usize;
    let mut spearman_sum = 0.0;

    for replay in replays {
        let sim_order: Vec<i32> = replay.results.iter().map(|r| r.finish_order).collect();
        if sim_order.iter().position(|&o| o == 0) == observed_winner {
            winner_hits += 1;
        }
        spearman_sum += spearman(&sim_order, &observed_order);
        for (gate, result) in replay.results.iter().enumerate() {
            acc[gate].finish_time_sum += f64::from(result.finish_time_raw);
            acc[gate].spurt_start_sum += f64::from(result.last_spurt_start_distance);
        }
        let mut seen: HashSet<(usize, i32)> = HashSet::new();
        for event in replay.events.iter().filter(|e| e.kind == EVENT_SKILL) {
            let (Some(&gate), Some(&skill)) = (event.params.first(), event.params.get(1)) else {
                continue;
            };
            if seen.insert((gate as usize, skill)) {
                *acc[gate as usize]
                    .fired
                    .entry(i64::from(skill))
                    .or_insert(0) += 1;
            }
        }
    }

    let mut finish_abs = 0.0;
    let mut finish_signed = 0.0;
    let mut spurt_abs = 0.0;
    let mut spurt_count = 0usize;
    let mut skill_abs = 0.0;
    let mut skill_count = 0usize;
    for (gate, result) in observed.results.iter().enumerate() {
        let mean_finish = acc[gate].finish_time_sum / rounds;
        finish_abs += (mean_finish - result.finish_time_raw).abs();
        finish_signed += mean_finish - result.finish_time_raw;
        if result.last_spurt_start_distance > 0.0 {
            spurt_abs +=
                (acc[gate].spurt_start_sum / rounds - result.last_spurt_start_distance).abs();
            spurt_count += 1;
        }
        for skill in &skills_per_runner[gate] {
            let rate = acc[gate].fired.get(skill).copied().unwrap_or(0) as f64 / rounds;
            let observed_fired = if fired[gate].contains_key(skill) {
                1.0
            } else {
                0.0
            };
            skill_abs += (rate - observed_fired).abs();
            skill_count += 1;
        }
    }

    let frames = frame_errors(fixture, &mean_sim_samples(observed, replays), None, None);

    Scores {
        finish_time_mae: finish_abs / runners as f64,
        finish_time_bias: finish_signed / runners as f64,
        winner_hit_rate: winner_hits as f64 / rounds,
        order_spearman: spearman_sum / rounds,
        spurt_start_mae: spurt_abs / spurt_count.max(1) as f64,
        skill_activation_error: skill_abs / skill_count.max(1) as f64,
        trajectory_mae: frames.mean(frames.distance_abs),
        speed_mae: frames.mean(frames.speed_abs),
        speed_bias: frames.mean(frames.speed_signed),
        hp_mae: frames.mean(frames.hp_abs),
        hp_bias: frames.mean(frames.hp_signed),
        rushed_agreement: frames.mean(frames.rushed_agreement),
    }
}

/// The skills the engine actually holds per runner, as numeric base ids.
fn engine_skills(params: &WasmRaceSimParams) -> Vec<Vec<i64>> {
    params
        .runners
        .iter()
        .map(|runner| {
            runner
                .skills
                .iter()
                .filter_map(|skill| skill_base_id(&skill.skill_id))
                .collect()
        })
        .collect()
}

fn print_scores(label: &str, scores: &Scores) {
    println!(
        "  {label:<7} finish MAE {:.3}s (bias {:+.3}s)  winner {:>3.0}%  spearman {:.3}  spurt MAE {:>6.1}m  skill err {:.3}  trajectory MAE {:>5.1}m  speed MAE {:.3} (bias {:+.3}) m/s  hp MAE {:>5.1} (bias {:+6.1})  rushed agree {:.3}",
        scores.finish_time_mae,
        scores.finish_time_bias,
        scores.winner_hit_rate * 100.0,
        scores.order_spearman,
        scores.spurt_start_mae,
        scores.skill_activation_error,
        scores.trajectory_mae,
        scores.speed_mae,
        scores.speed_bias,
        scores.hp_mae,
        scores.hp_bias,
        scores.rushed_agreement,
    );
}

/// Per-runner breakdown of a run, so a bad aggregate points at a runner.
/// Speed and HP biases are (simulated - recorded) per race phase.
fn print_runner_report(fixture: &Fixture, replays: &[RaceReplay]) {
    let observed = &fixture.observed;
    let rounds = replays.len() as f64;
    let means = mean_sim_samples(observed, replays);
    println!(
        "          {:<18} {:>5} {:>8} {:>8} {:>9}  {:^24}  {:^24}  {:>8}",
        "runner",
        "style",
        "obs fin",
        "fin dev",
        "spurt dev",
        "speed bias early/mid/late",
        "hp bias early/mid/late",
        "traj MAE"
    );
    println!(
        "          {:<18} {:>5} {:>8} {:>8} {:>9}  {:^24}  {:^24}  {:>8}  {:>17}",
        "", "", "", "", "", "", "", "", "blocked mid/late"
    );
    for (gate, result) in observed.results.iter().enumerate() {
        let mean_finish = replays
            .iter()
            .map(|r| f64::from(r.results[gate].finish_time_raw))
            .sum::<f64>()
            / rounds;
        let mean_spurt = replays
            .iter()
            .map(|r| f64::from(r.results[gate].last_spurt_start_distance))
            .sum::<f64>()
            / rounds;
        let by_phase: Vec<FrameErrors> = Phase::ALL
            .iter()
            .map(|&phase| frame_errors(fixture, &means, Some(gate), Some(phase)))
            .collect();
        let whole = frame_errors(fixture, &means, Some(gate), None);
        println!(
            "          {:<18} {:>5} {:>8.3} {:>+8.3} {:>+9.1}  {:>+7.3} {:>+7.3} {:>+7.3}  {:>+7.1} {:>+7.1} {:>+7.1}  {:>7.1}m  obs {:.2}/{:.2} sim {:.2}/{:.2}",
            fixture.horses[gate]
                .name
                .chars()
                .take(18)
                .collect::<String>(),
            fixture.params.runners[gate].strategy,
            result.finish_time_raw,
            mean_finish - result.finish_time_raw,
            mean_spurt - result.last_spurt_start_distance,
            by_phase[0].mean(by_phase[0].speed_signed),
            by_phase[1].mean(by_phase[1].speed_signed),
            by_phase[2].mean(by_phase[2].speed_signed),
            by_phase[0].mean(by_phase[0].hp_signed),
            by_phase[1].mean(by_phase[1].hp_signed),
            by_phase[2].mean(by_phase[2].hp_signed),
            whole.mean(whole.distance_abs),
            by_phase[1].mean(by_phase[1].blocked_observed),
            by_phase[2].mean(by_phase[2].blocked_observed),
            by_phase[1].mean(by_phase[1].blocked_sim),
            by_phase[2].mean(by_phase[2].blocked_sim),
        );
    }
    let field: Vec<FrameErrors> = Phase::ALL
        .iter()
        .map(|&phase| frame_errors(fixture, &means, None, Some(phase)))
        .collect();
    println!(
        "          {:<18} {:>5} {:>8} {:>8} {:>9}  {:>+7.3} {:>+7.3} {:>+7.3}  {:>+7.1} {:>+7.1} {:>+7.1}",
        "field",
        "",
        "",
        "",
        "",
        field[0].mean(field[0].speed_signed),
        field[1].mean(field[1].speed_signed),
        field[2].mean(field[2].speed_signed),
        field[0].mean(field[0].hp_signed),
        field[1].mean(field[1].hp_signed),
        field[2].mean(field[2].hp_signed),
    );
}

/// One runner's recorded frames against the mean simulated state, line by
/// line, for `ACCURACY_TRACE=<gate>`.
fn print_trace(fixture: &Fixture, result: &RaceSimResult, gate: usize) {
    let replays = &result.replays;
    let means = mean_sim_samples(&fixture.observed, replays);
    // The engine's own effect windows for this gate in the first round, so a
    // speed or acceleration excess can be matched to the skill behind it.
    if let Some(trace) = result
        .collected
        .rounds
        .first()
        .and_then(|round| round.focus.iter().find(|t| t.runner_id.0 as usize == gate))
    {
        let mut logs: Vec<_> = trace
            .skill_activations
            .values()
            .flatten()
            .map(|log| (log.start, log.end, log.skill_id.clone(), log.effect_type))
            .collect();
        logs.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        println!("          engine effect windows (round 0): start-end m  skill  effect type");
        for (start, end, skill_id, effect_type) in logs {
            println!("          {start:7.1}-{end:7.1}  {skill_id:>8}  type {effect_type}");
        }
    }
    println!(
        "          trace gate {gate} {}: time | distance obs sim dev | speed obs sim dev | hp obs sim dev | rushed obs sim",
        fixture.horses[gate].name
    );
    for (frame_index, frame) in fixture.observed.frames.iter().enumerate() {
        let Some(sim) = means.get(&(frame_index, gate)) else {
            continue;
        };
        let obs = observed_sample(frame, gate);
        println!(
            "          {:6.2} | {:7.1} {:7.1} {:+6.1} | {:6.2} {:6.2} {:+6.2} | {:6.0} {:6.0} {:+6.0} | {:.0} {:.2}",
            frame.time,
            obs.distance,
            sim.distance,
            sim.distance - obs.distance,
            obs.speed,
            sim.speed,
            sim.speed - obs.speed,
            obs.hp,
            sim.hp,
            sim.hp - obs.hp,
            obs.rushed,
            sim.rushed,
        );
    }
}

/// Baseline file shape: fixture file -> mode -> scores.
type Baseline = BTreeMap<String, BTreeMap<String, Scores>>;

fn baseline_path() -> PathBuf {
    fixture_dir().join("baseline.json")
}

fn load_baseline() -> Baseline {
    fs::read_to_string(baseline_path())
        .ok()
        .map(|text| serde_json::from_str(&text).expect("parse baseline"))
        .unwrap_or_default()
}

fn check_against_baseline(
    baseline: &Baseline,
    file: &str,
    mode: &str,
    scores: &Scores,
) -> Vec<String> {
    let Some(previous) = baseline.get(file).and_then(|modes| modes.get(mode)) else {
        return vec![format!("{file} [{mode}]: no baseline entry")];
    };
    let mut failures = Vec::new();
    if scores.finish_time_mae > previous.finish_time_mae + FINISH_TIME_TOLERANCE {
        failures.push(format!(
            "{file} [{mode}]: finish MAE regressed {:.3}s -> {:.3}s",
            previous.finish_time_mae, scores.finish_time_mae
        ));
    }
    if scores.trajectory_mae > previous.trajectory_mae + TRAJECTORY_TOLERANCE {
        failures.push(format!(
            "{file} [{mode}]: trajectory MAE regressed {:.2}m -> {:.2}m",
            previous.trajectory_mae, scores.trajectory_mae
        ));
    }
    if scores.speed_mae > previous.speed_mae + SPEED_TOLERANCE {
        failures.push(format!(
            "{file} [{mode}]: speed MAE regressed {:.3} -> {:.3} m/s",
            previous.speed_mae, scores.speed_mae
        ));
    }
    if scores.hp_mae > previous.hp_mae + HP_TOLERANCE {
        failures.push(format!(
            "{file} [{mode}]: HP MAE regressed {:.1} -> {:.1}",
            previous.hp_mae, scores.hp_mae
        ));
    }
    failures
}

#[test]
#[ignore = "local accuracy harness; run with `cargo test -p honse-sim-wasm --test capture_accuracy -- --ignored`"]
fn captured_races_score_no_worse_than_baseline() {
    let fixtures = load_fixtures();
    assert!(!fixtures.is_empty(), "no capture fixtures found");
    let nsamples = samples();
    let update = std::env::var_os("UPDATE_ACCURACY_BASELINE").is_some();
    let baseline = load_baseline();
    let mut next_baseline: Baseline = BTreeMap::new();
    let mut failures = Vec::new();

    println!("capture accuracy over {nsamples} seeds per run");
    for fixture in &fixtures {
        let dropped: usize = fixture
            .horses
            .iter()
            .map(|h| h.dropped_skill_ids.len())
            .sum();
        println!(
            "{} (course {}, {} runners, {} skills dropped by the exporter)",
            fixture.source.file,
            fixture.source.course_id,
            fixture.horses.len(),
            dropped
        );
        assert_eq!(
            fixture.params.runners.len(),
            fixture.observed.results.len(),
            "{}: runner count differs from replay",
            fixture.source.file
        );
        assert!(
            fixture
                .params
                .runners
                .iter()
                .enumerate()
                .all(|(index, runner)| runner.gate == Some(index as i64)),
            "{}: every runner must be pinned to its gate",
            fixture.source.file
        );

        let started = std::time::Instant::now();
        let free_replays = run(&fixture.params, nsamples);
        let simulated = started.elapsed();
        let free = score(fixture, &free_replays, &engine_skills(&fixture.params));
        println!(
            "  timing  simulate {:.2}s  score {:.2}s",
            simulated.as_secs_f64(),
            (started.elapsed() - simulated).as_secs_f64()
        );
        print_scores("free", &free);

        let mut pinned_params = fixture.params.clone();
        pin_outcomes(&mut pinned_params, &fixture.observed, fixture);
        let started = std::time::Instant::now();
        let pinned_result = run_full(&pinned_params, nsamples);
        let pinned_replays = pinned_result.replays.clone();
        let simulated = started.elapsed();
        let pinned = score(fixture, &pinned_replays, &engine_skills(&pinned_params));
        print_scores("pinned", &pinned);
        print_runner_report(fixture, &pinned_replays);
        if let Some(gate) = std::env::var("ACCURACY_TRACE")
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .filter(|&g| g < fixture.horses.len())
        {
            print_trace(fixture, &pinned_result, gate);
        }
        // The pinning seams must hold or the pinned scores mean nothing.
        assert!(
            pinned.skill_activation_error < 0.05,
            "{}: pinned run fired the wrong skills (error {:.3})",
            fixture.source.file,
            pinned.skill_activation_error
        );
        println!(
            "  timing  simulate {:.2}s  score+report {:.2}s",
            simulated.as_secs_f64(),
            (started.elapsed() - simulated).as_secs_f64()
        );

        for (mode, scores) in [("free", free), ("pinned", pinned)] {
            failures.extend(check_against_baseline(
                &baseline,
                &fixture.source.file,
                mode,
                &scores,
            ));
            next_baseline
                .entry(fixture.source.file.clone())
                .or_default()
                .insert(mode.to_owned(), scores);
        }
    }

    if update {
        let text = serde_json::to_string_pretty(&next_baseline).expect("serialize baseline");
        fs::write(baseline_path(), text + "\n").expect("write baseline");
        println!("baseline updated at {}", baseline_path().display());
        return;
    }
    assert!(
        failures.is_empty(),
        "accuracy regressed:\n{}",
        failures.join("\n")
    );
}
