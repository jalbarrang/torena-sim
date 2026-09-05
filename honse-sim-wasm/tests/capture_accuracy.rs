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
//!   skills it never fired are removed, and the last spurt starts where the
//!   game recorded it. What is left is the deterministic part (speed,
//!   acceleration, HP), so a residual here is a formula error, not luck.
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
use honse_sim::contested::run_race_sim;
use serde::{Deserialize, Serialize};
use uma_sim_wasm::dto::WasmRaceSimParams;

const TICK_SECONDS: f64 = 1.0 / 15.0;
/// `SimulateEventType.SKILL` in both the game replay and `RaceReplay`.
const EVENT_SKILL: i8 = 3;
const DEFAULT_SAMPLES: usize = 8;
/// Slack on the regression gate, so float noise across platforms never trips it.
const FINISH_TIME_TOLERANCE: f64 = 0.02;
const TRAJECTORY_TOLERANCE: f64 = 0.25;

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

/// One recorded frame, columnar: `distance[gate]` in meters.
#[derive(Deserialize)]
struct ObservedFrame {
    time: f64,
    distance: Vec<f64>,
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

/// Force the observed activations, drop every skill the game never fired, and
/// start each last spurt where the game recorded it.
fn pin_outcomes(params: &mut WasmRaceSimParams, observed: &Observed) {
    let activations = observed_activations(observed);
    for ((runner, fired), result) in params
        .runners
        .iter_mut()
        .zip(&activations)
        .zip(&observed.results)
    {
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

fn run(params: &WasmRaceSimParams, nsamples: usize) -> Vec<RaceReplay> {
    let mut domain = params
        .clone()
        .into_domain()
        .expect("fixture params convert");
    domain.nsamples = nsamples;
    run_race_sim(domain).expect("race runs").replays
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

fn sim_distance_at(replay: &RaceReplay, gate: usize, time: f64) -> Option<f64> {
    let index = (time / TICK_SECONDS).round() as usize;
    replay
        .frames
        .get(index)
        .map(|frame| f64::from(frame.horses[gate].distance))
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
    // (observed frame, gate) -> (sum of simulated distance, rounds still running there).
    let mut trajectory_sum: BTreeMap<(usize, usize), (f64, usize)> = BTreeMap::new();

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
        for (frame_index, frame) in observed.frames.iter().enumerate() {
            for gate in 0..runners {
                if let Some(distance) = sim_distance_at(replay, gate, frame.time) {
                    let slot = trajectory_sum
                        .entry((frame_index, gate))
                        .or_insert((0.0, 0));
                    slot.0 += distance;
                    slot.1 += 1;
                }
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

    let mut trajectory_abs = 0.0;
    let mut trajectory_count = 0usize;
    for ((frame_index, gate), (sum, count)) in &trajectory_sum {
        let observed_distance = observed.frames[*frame_index].distance[*gate];
        trajectory_abs += (sum / *count as f64 - observed_distance).abs();
        trajectory_count += 1;
    }

    Scores {
        finish_time_mae: finish_abs / runners as f64,
        finish_time_bias: finish_signed / runners as f64,
        winner_hit_rate: winner_hits as f64 / rounds,
        order_spearman: spearman_sum / rounds,
        spurt_start_mae: spurt_abs / spurt_count.max(1) as f64,
        skill_activation_error: skill_abs / skill_count.max(1) as f64,
        trajectory_mae: trajectory_abs / trajectory_count.max(1) as f64,
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
        "  {label:<7} finish MAE {:.3}s (bias {:+.3}s)  winner {:>3.0}%  spearman {:.3}  spurt MAE {:>6.1}m  skill err {:.3}  trajectory MAE {:>5.1}m",
        scores.finish_time_mae,
        scores.finish_time_bias,
        scores.winner_hit_rate * 100.0,
        scores.order_spearman,
        scores.spurt_start_mae,
        scores.skill_activation_error,
        scores.trajectory_mae,
    );
}

/// Per-runner breakdown of a run, so a bad aggregate points at a runner.
fn print_runner_report(fixture: &Fixture, replays: &[RaceReplay]) {
    let observed = &fixture.observed;
    let rounds = replays.len() as f64;
    println!(
        "          {:<18} {:>5} {:>8} {:>8} {:>9} {:>9}",
        "runner", "style", "obs fin", "sim dev", "spurt obs", "spurt dev"
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
        let mut trajectory_abs = 0.0;
        let mut count = 0usize;
        for frame in &observed.frames {
            let sims: Vec<f64> = replays
                .iter()
                .filter_map(|r| sim_distance_at(r, gate, frame.time))
                .collect();
            if !sims.is_empty() {
                let mean = sims.iter().sum::<f64>() / sims.len() as f64;
                trajectory_abs += (mean - frame.distance[gate]).abs();
                count += 1;
            }
        }
        println!(
            "          {:<18} {:>5} {:>8.3} {:>+8.3} {:>9.1} {:>+9.1}  trajectory MAE {:>5.1}m",
            fixture.horses[gate]
                .name
                .chars()
                .take(18)
                .collect::<String>(),
            fixture.params.runners[gate].strategy,
            result.finish_time_raw,
            mean_finish - result.finish_time_raw,
            result.last_spurt_start_distance,
            mean_spurt - result.last_spurt_start_distance,
            trajectory_abs / count.max(1) as f64,
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
        pin_outcomes(&mut pinned_params, &fixture.observed);
        let started = std::time::Instant::now();
        let pinned_replays = run(&pinned_params, nsamples);
        let simulated = started.elapsed();
        let pinned = score(fixture, &pinned_replays, &engine_skills(&pinned_params));
        print_scores("pinned", &pinned);
        print_runner_report(fixture, &pinned_replays);
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
