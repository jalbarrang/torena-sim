//! Local measurement, not a CI gate: how often does proximity dueling fire in
//! the capture fixtures, how long does each spell last, and how much speed and
//! acceleration does it hand out?
//!
//! ```text
//! cargo test -p honse-sim-wasm --test dueling_activity -- --ignored --nocapture
//! ```
//!
//! `DUELING_SAMPLES` overrides the seed count (default 8) and `DUELING_FIXTURE`
//! filters by file name, the same knobs the accuracy harness exposes.
//!
//! Why this exists: the capture accuracy harness left an open item,
//! "Late-race speed excess is overtaking time". Dueling fires in exactly that
//! window — final straight, packed, top half — and grants both target speed and
//! acceleration. The capture replay does not record dueling at all, so its share
//! of the late-race error has never been measured. This prints that share, so
//! the open item can be argued with numbers instead of a hunch.
//!
//! It reconstructs the field the way [`honse_sim::contested::run_race_sim`] does
//! and swaps the telemetry collector for [`RaceEventLogCollector`], which is the
//! only place dueling transitions are observable.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;

use honse_sim::contested::collectors::{
    RaceEventLog, RaceEventLogCollector, RaceLogEvent, RaceLogEventKind,
};
use honse_sim::contested::{Race, RaceSimParams};
use serde::Deserialize;
use uma_sim_wasm::dto::WasmRaceSimParams;

const DEFAULT_SAMPLES: usize = 8;
const TICKS_PER_SECOND: f64 = 15.0;

/// Only `params` is read; the rest of the fixture is ignored.
#[derive(Deserialize)]
struct ParamsOnly {
    params: WasmRaceSimParams,
}

/// A closed dueling spell for one runner.
struct Spell {
    /// Gate index of the runner that dueled.
    runner: usize,
    /// Guts of the runner that dueled, used for the bonus estimate.
    guts: f64,
    start_position: f64,
    end_position: f64,
    ticks: i64,
    /// Runners sharing the duel, as logged on the start event.
    partners: Vec<u32>,
}

impl Spell {
    fn meters(&self) -> f64 {
        (self.end_position - self.start_position).max(0.0)
    }

    fn seconds(&self) -> f64 {
        self.ticks as f64 / TICKS_PER_SECOND
    }
}

/// Dueling's Guts-scaled target speed bonus: `(200 * guts)^0.708 * 0.0001` m/s.
fn speed_bonus(guts: f64) -> f64 {
    (200.0 * guts).powf(0.708) * 0.0001
}

/// Dueling's Guts-scaled acceleration bonus: `(160 * guts)^0.59 * 0.0001` m/s².
fn accel_bonus(guts: f64) -> f64 {
    (160.0 * guts).powf(0.59) * 0.0001
}

fn fixture_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/captures")
}

fn samples() -> usize {
    std::env::var("DUELING_SAMPLES")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(DEFAULT_SAMPLES)
}

fn fixture_paths() -> Vec<PathBuf> {
    let only = std::env::var("DUELING_FIXTURE").unwrap_or_default();
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
}

/// Pair `DuelingStart` with `DuelingEnd` per runner inside one round.
///
/// A spell still open when the round ends belongs to a runner that finished
/// while dueling: the coordinator only walks unfinished runners, so no
/// `DuelingEnd` is ever logged for her. Those close at the course distance.
fn spells_in_round(round: &[RaceLogEvent], guts: &[f64], course_distance: f64) -> Vec<Spell> {
    let last_tick = round.iter().map(|event| event.tick).max().unwrap_or(0);
    let mut open: HashMap<u32, (f64, i64, Vec<u32>)> = HashMap::new();
    let mut spells = Vec::new();

    for event in round {
        let id = event.runner_id.0;
        match event.kind {
            RaceLogEventKind::DuelingStart => {
                let partners = event
                    .detail
                    .as_ref()
                    .map(|detail| detail.other_runner_ids.iter().map(|r| r.0).collect())
                    .unwrap_or_default();
                open.insert(id, (event.position, event.tick, partners));
            }
            RaceLogEventKind::DuelingEnd => {
                if let Some((start, tick, partners)) = open.remove(&id) {
                    spells.push(Spell {
                        runner: id as usize,
                        guts: guts.get(id as usize).copied().unwrap_or(0.0),
                        start_position: start,
                        end_position: event.position,
                        ticks: event.tick - tick,
                        partners,
                    });
                }
            }
            _ => {}
        }
    }

    for (id, (start, tick, partners)) in open {
        spells.push(Spell {
            runner: id as usize,
            guts: guts.get(id as usize).copied().unwrap_or(0.0),
            start_position: start,
            end_position: course_distance,
            ticks: last_tick - tick,
            partners,
        });
    }
    spells
}

/// Running totals across every fixture and round.
#[derive(Default)]
struct Totals {
    rounds: usize,
    rounds_with_a_duel: usize,
    spells: Vec<Spell>,
    /// Field meters run, sum over rounds of `runners * course_distance`.
    runner_meters: f64,
    /// Field seconds run, sum over rounds of `runners * race duration`.
    runner_seconds: f64,
}

impl Totals {
    fn duel_meters(&self) -> f64 {
        self.spells.iter().map(Spell::meters).sum()
    }

    /// Extra meters the duel bonus is worth: `speed bonus × spell duration`.
    fn extra_meters(&self) -> f64 {
        self.spells
            .iter()
            .map(|spell| speed_bonus(spell.guts) * spell.seconds())
            .sum()
    }

    fn mean<F: Fn(&Spell) -> f64>(&self, f: F) -> f64 {
        if self.spells.is_empty() {
            0.0
        } else {
            self.spells.iter().map(f).sum::<f64>() / self.spells.len() as f64
        }
    }
}

#[test]
#[ignore = "local measurement; run with `cargo test -p honse-sim-wasm --test dueling_activity -- --ignored --nocapture`"]
fn dueling_activity_across_captures() {
    let paths = fixture_paths();
    assert!(!paths.is_empty(), "no capture fixtures found");
    let nsamples = samples();

    println!("dueling activity, {nsamples} seeds per fixture\n");

    let mut totals = Totals::default();

    for path in &paths {
        let text = fs::read_to_string(path).expect("read fixture");
        let fixture: ParamsOnly =
            serde_json::from_str(&text).unwrap_or_else(|e| panic!("parse {}: {e}", path.display()));
        let domain: RaceSimParams = fixture
            .params
            .into_domain()
            .unwrap_or_else(|e| panic!("{}: params convert: {e}", path.display()));

        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let course_distance = domain.course.distance;
        let final_straight = domain.course.straights.last().map(|s| (s.start, s.end));
        let guts: Vec<f64> = domain
            .runners
            .iter()
            .map(|runner| f64::from(runner.stats.guts))
            .collect();
        let runner_count = guts.len();
        let master_seed = domain.master_seed;
        let dueling_enabled = domain.settings.dueling;

        // Same construction `run_race_sim` performs, with the event log
        // collector in place of the telemetry collector.
        let mut race = Race::new(
            domain.course,
            domain.ground,
            domain.settings,
            domain.parameters,
        );
        for runner in domain.runners {
            race.add_runner(runner);
        }
        let collector = RaceEventLogCollector::new();
        race.subscribe(collector.handle());
        for i in 0..nsamples {
            race.prepare_round(master_seed + i as u64);
            race.run();
        }
        let log: RaceEventLog = collector.result();

        let mut spells: Vec<Spell> = Vec::new();
        let mut rounds_with_a_duel = 0usize;
        let mut runner_seconds = 0.0f64;
        for round in &log {
            let round_spells = spells_in_round(round, &guts, course_distance);
            if !round_spells.is_empty() {
                rounds_with_a_duel += 1;
            }
            spells.extend(round_spells);
            let last_tick = round.iter().map(|event| event.tick).max().unwrap_or(0);
            runner_seconds += runner_count as f64 * last_tick as f64 / TICKS_PER_SECOND;
        }

        let dueled: HashSet<usize> = spells.iter().map(|s| s.runner).collect();
        let duel_meters: f64 = spells.iter().map(Spell::meters).sum();
        let rounds = log.len();
        let runner_meters = rounds as f64 * runner_count as f64 * course_distance;
        let mean_seconds = if spells.is_empty() {
            0.0
        } else {
            spells.iter().map(Spell::seconds).sum::<f64>() / spells.len() as f64
        };
        let mean_speed = if spells.is_empty() {
            0.0
        } else {
            spells.iter().map(|s| speed_bonus(s.guts)).sum::<f64>() / spells.len() as f64
        };
        let mean_accel = if spells.is_empty() {
            0.0
        } else {
            spells.iter().map(|s| accel_bonus(s.guts)).sum::<f64>() / spells.len() as f64
        };
        let with_partner = spells.iter().filter(|s| !s.partners.is_empty()).count();
        let on_straight = final_straight.map(|(start, _)| {
            let total = spells.len().max(1);
            spells.iter().filter(|s| s.start_position >= start).count() as f64 / total as f64
        });
        let extra_meters: f64 = spells
            .iter()
            .map(|s| speed_bonus(s.guts) * s.seconds())
            .sum();

        println!(
            "{name}  (course {course_distance:.0}m, {runner_count} runners, dueling {})",
            if dueling_enabled { "on" } else { "OFF" }
        );
        match final_straight {
            Some((start, end)) => println!("  final straight {start:.0}-{end:.0}m"),
            None => println!("  final straight: none in course data"),
        }
        println!(
            "  rounds {rounds}   rounds with a duel {rounds_with_a_duel}   spells {}",
            spells.len()
        );
        println!(
            "  spells with a logged partner {with_partner}/{}   gate indexes that dueled {}/{runner_count}",
            spells.len(),
            dueled.len()
        );
        println!(
            "  duel distance {duel_meters:.0}m of {runner_meters:.0}m runner-meters ({:.2}%)",
            100.0 * duel_meters / runner_meters.max(f64::EPSILON)
        );
        println!(
            "  mean spell {:.1}m / {mean_seconds:.2}s   speed +{mean_speed:.4} m/s   accel +{mean_accel:.4} m/s2",
            if spells.is_empty() {
                0.0
            } else {
                duel_meters / spells.len() as f64
            }
        );
        if let Some(ratio) = on_straight {
            println!(
                "  spells starting on the final straight {:.0}%",
                ratio * 100.0
            );
        }
        println!(
            "  extra distance from the bonus ~{extra_meters:.0}m   time-averaged lift over the field +{:.4} m/s",
            extra_meters / runner_seconds.max(f64::EPSILON)
        );
        println!();

        totals.rounds += rounds;
        totals.rounds_with_a_duel += rounds_with_a_duel;
        totals.runner_meters += runner_meters;
        totals.runner_seconds += runner_seconds;
        totals.spells.extend(spells);
    }

    println!("=== overall ===");
    println!(
        "{} rounds, {} duel spells, {} rounds with at least one duel ({:.0}%)",
        totals.rounds,
        totals.spells.len(),
        totals.rounds_with_a_duel,
        100.0 * totals.rounds_with_a_duel as f64 / totals.rounds.max(1) as f64
    );
    println!(
        "duel distance {:.0}m of {:.0}m runner-meters ({:.2}%)",
        totals.duel_meters(),
        totals.runner_meters,
        100.0 * totals.duel_meters() / totals.runner_meters.max(f64::EPSILON)
    );
    println!(
        "mean spell {:.2}s   mean speed bonus +{:.4} m/s   mean accel bonus +{:.4} m/s2",
        totals.mean(Spell::seconds),
        totals.mean(|s| speed_bonus(s.guts)),
        totals.mean(|s| accel_bonus(s.guts))
    );
    println!(
        "extra distance from the bonus ~{:.0}m of {:.0}m runner-meters ({:.3}%)",
        totals.extra_meters(),
        totals.runner_meters,
        100.0 * totals.extra_meters() / totals.runner_meters.max(f64::EPSILON)
    );
    println!(
        "time-averaged target-speed lift over every runner-second: {:+.4} m/s",
        totals.extra_meters() / totals.runner_seconds.max(f64::EPSILON)
    );
}
