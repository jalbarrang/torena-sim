//! Instrumented repro for the Discord "10-speed Long G front runner keeps up
//! with fronts" report. Prints a per-section dump of the focus runner vs the
//! field; assertions encode the expected Long-G acceleration lag so a future
//! fidelity fix has a concrete gate.
//!
//! Field mirrors the reporter's exported config (torena-sim-race-0i5d759.json):
//! Tokyo turf 2500m (course 10506), Good ground, 9 runners at Great mood.
//! Skills and course geometry (corners/slopes) are omitted — the harness has no
//! skill-id plumbing — so absolute gaps differ from the live sim; the dump is
//! for pacing-shape classification, not time parity.

use std::collections::HashMap;

use honse_sim::contested::{Race, SimulationSettings};
use honse_sim::course::model::CourseData;
use honse_sim::runner::lifecycle::{CreateRunner, RunnerAptitudes};
use honse_sim::shared_kernel::language::{
    Aptitude, DistanceType, Grade, GroundCondition, Mood, Orientation, Season, Strategy, Surface,
    TimeOfDay, Weather,
};
use honse_sim::shared_kernel::params::{RaceParameters, StatLine};
use honse_sim::skills::effect::PositionKeepState;

const FRAME_DT: f64 = 1.0 / 15.0;
const COURSE_DISTANCE: f64 = 2500.0;
const SEED: u64 = 575_032;

fn long_course() -> CourseData {
    CourseData {
        course_id: 1,
        race_track_id: 10001,
        distance: COURSE_DISTANCE,
        distance_type: DistanceType::Long,
        surface: Surface::Turf,
        turn: Orientation::Clockwise,
        course_set_status: vec![],
        corners: vec![],
        straights: vec![],
        slopes: vec![],
        lane_max: 10.0,
        course_width: 30.0,
        horse_lane: 1.5,
        lane_change_acceleration: 0.0,
        lane_change_acceleration_per_frame: 0.0,
        max_lane_distance: 0.0,
        move_lane_point: 0.0,
        is_abroad: false,
    }
}

fn test_race_params() -> RaceParameters {
    RaceParameters {
        ground: GroundCondition::Firm,
        weather: Weather::Sunny,
        season: Season::Spring,
        time_of_day: TimeOfDay::Midday,
        grade: Grade::G1,
        num_umas: Some(9),
        order_ranges: None,
        skill_id: None,
        strategy_counts: None,
        common_skills: None,
    }
}

fn empty_forced() -> CreateRunner {
    CreateRunner {
        outfit_id: "100302".to_owned(),
        name: String::new(),
        mood: Mood::Normal,
        strategy: Strategy::FrontRunner,
        popularity: 0,
        team: None,
        aptitudes: RunnerAptitudes {
            distance: Aptitude::A,
            strategy: Aptitude::A,
            surface: Aptitude::A,
        },
        stats: StatLine {
            speed: 1000,
            stamina: 1000,
            power: 1000,
            guts: 1000,
            wit: 800,
        },
        skills: vec![],
        forced_positions: HashMap::new(),
        injected_debuffs: vec![],
        forced_rushed_regions: vec![],
        forced_dueling_regions: vec![],
        forced_spot_struggle_regions: vec![],
        forced_rank: vec![],
        gate: None,
        forced_start_delay: None,
    }
}

fn bakushin() -> CreateRunner {
    let mut r = empty_forced();
    r.name = "Sakura Bakushin O".to_owned();
    r.mood = Mood::Great;
    r.strategy = Strategy::FrontRunner;
    r.aptitudes = RunnerAptitudes {
        distance: Aptitude::G,
        strategy: Aptitude::A,
        surface: Aptitude::A,
    };
    r.stats = StatLine {
        speed: 10,
        stamina: 850,
        power: 1200,
        guts: 600,
        wit: 1300,
    };
    r
}

#[allow(clippy::too_many_arguments)]
fn pack_runner(
    name: &str,
    strategy: Strategy,
    stats: StatLine,
    distance_apt: Aptitude,
    strategy_apt: Aptitude,
) -> CreateRunner {
    let mut r = empty_forced();
    r.name = name.to_owned();
    r.mood = Mood::Great;
    r.strategy = strategy;
    r.aptitudes = RunnerAptitudes {
        distance: distance_apt,
        strategy: strategy_apt,
        surface: Aptitude::A,
    };
    r.stats = stats;
    r
}

fn stats(speed: i32, stamina: i32, power: i32, guts: i32, wit: i32) -> StatLine {
    StatLine {
        speed,
        stamina,
        power,
        guts,
        wit,
    }
}

fn build_race() -> Race {
    let mut race = Race::new(
        long_course(),
        GroundCondition::Good,
        SimulationSettings::default(),
        test_race_params(),
    );
    race.add_runner(bakushin());
    race.add_runner(pack_runner(
        "Mob 103702",
        Strategy::LateSurger,
        stats(1200, 600, 800, 400, 1300),
        Aptitude::A,
        Aptitude::G,
    ));
    race.add_runner(pack_runner(
        "Mob 100201",
        Strategy::Runaway,
        stats(1200, 600, 800, 400, 1200),
        Aptitude::D,
        Aptitude::A,
    ));
    race.add_runner(pack_runner(
        "Mob 100602",
        Strategy::PaceChaser,
        stats(1600, 750, 1100, 550, 1200),
        Aptitude::S,
        Aptitude::A,
    ));
    race.add_runner(pack_runner(
        "Mob 104101",
        Strategy::PaceChaser,
        stats(1600, 901, 1200, 601, 1300),
        Aptitude::S,
        Aptitude::A,
    ));
    race.add_runner(pack_runner(
        "Mob 105001",
        Strategy::EndCloser,
        stats(1600, 800, 1100, 600, 1200),
        Aptitude::S,
        Aptitude::A,
    ));
    race.add_runner(pack_runner(
        "Mob 102602",
        Strategy::FrontRunner,
        stats(1600, 850, 1100, 600, 1300),
        Aptitude::S,
        Aptitude::A,
    ));
    race.add_runner(pack_runner(
        "Mob 103402",
        Strategy::EndCloser,
        stats(1600, 850, 1100, 600, 1200),
        Aptitude::S,
        Aptitude::A,
    ));
    race.add_runner(pack_runner(
        "Mob 106801",
        Strategy::FrontRunner,
        stats(1600, 850, 1100, 600, 1200),
        Aptitude::S,
        Aptitude::A,
    ));
    race
}

#[derive(Debug, Clone)]
struct SectionSnap {
    section: usize,
    position: f64,
    gap_to_leader: f64,
    current_speed: f64,
    target_speed: f64,
    pos_keep: PositionKeepState,
    pos_keep_coef: f64,
    phase: u8,
    out_of_hp: bool,
}

#[test]
fn long_g_ten_speed_front_runner_pacing_dump() {
    let mut race = build_race();
    race.prepare_round(SEED);

    let focus = race
        .runners()
        .iter()
        .find(|r| r.name == "Sakura Bakushin O")
        .expect("bakushin present");
    let accel0 = focus.base_accelerations[0];
    let adj_speed = focus.adjusted_stats.speed;
    let adj_power = focus.adjusted_stats.power;
    let dist_apt = focus.aptitudes.distance;
    let early_target = focus.base_target_speed_per_phase[0];
    let mid_target = focus.base_target_speed_per_phase[1];
    let late_target = focus.base_target_speed_per_phase[2];
    let last_spurt = focus.last_spurt_speed;
    let pos_keep_end = focus.pos_keep_end;
    let section_length = focus.section_length;

    eprintln!("=== focus init ===");
    eprintln!("distance aptitude: {dist_apt:?}");
    eprintln!("adjusted speed/power: {adj_speed:.2}/{adj_power:.2}");
    eprintln!(
        "base_accelerations[0..=2]: {:.4}/{:.4}/{:.4}",
        focus.base_accelerations[0], focus.base_accelerations[1], focus.base_accelerations[2]
    );
    eprintln!("phase targets early/mid/late: {early_target:.3}/{mid_target:.3}/{late_target:.3}");
    eprintln!("last_spurt_speed: {last_spurt:.3}");
    eprintln!("pos_keep_end: {pos_keep_end:.1} (section_length={section_length:.1})");

    // Accel distance proficiency for G is 0.4 (NOT the speed table's 0.1).
    // With power ≈ 1198 (1200 * 1.04 Great − 50 Good-turf ground) and FR early
    // strategy coef 1.0:
    //   0.0006 * sqrt(500*1198) * 1.0 * 1.0 * 0.4 ≈ 0.1857
    assert_eq!(
        dist_apt,
        Aptitude::G,
        "G distance aptitude must survive prepare"
    );
    assert!(
        (accel0 - 0.1857).abs() < 0.001,
        "Long G early accel should be ~0.1857, got {accel0}"
    );

    let mut snaps: Vec<SectionSnap> = Vec::new();
    let mut next_section = 0usize;
    let total_sections = 24usize;

    while race.finished_runners().len() < race.runners().len() {
        race.on_update(FRAME_DT);

        let leader_pos = race
            .runners()
            .iter()
            .map(|r| r.position)
            .fold(0.0_f64, f64::max);
        let focus = race
            .runners()
            .iter()
            .find(|r| r.name == "Sakura Bakushin O")
            .expect("bakushin present");
        let section = (focus.position / section_length).floor() as usize;
        if section >= next_section && next_section < total_sections {
            snaps.push(SectionSnap {
                section: next_section,
                position: focus.position,
                gap_to_leader: leader_pos - focus.position,
                current_speed: focus.current_speed,
                target_speed: focus.target_speed,
                pos_keep: focus.position_keep_state,
                pos_keep_coef: focus.pos_keep_speed_coef,
                phase: focus.phase.index() as u8,
                out_of_hp: focus.out_of_hp,
            });
            next_section = section + 1;
        }
    }

    eprintln!("=== per-section dump (focus) ===");
    eprintln!(
        "sec | pos     | gap_to_1st | cur_spd | tgt_spd | pk_coef | pk_state   | phase | oohp"
    );
    for s in &snaps {
        eprintln!(
            "{:>3} | {:>7.1} | {:>9.1} | {:>7.2} | {:>7.2} | {:>7.3} | {:<10?} | {:>5} | {}",
            s.section,
            s.position,
            s.gap_to_leader,
            s.current_speed,
            s.target_speed,
            s.pos_keep_coef,
            s.pos_keep,
            s.phase,
            s.out_of_hp
        );
    }

    let focus = race
        .runners()
        .iter()
        .find(|r| r.name == "Sakura Bakushin O")
        .expect("bakushin present");
    eprintln!("=== position_keep_activations ===");
    for a in &focus.position_keep_activations {
        eprintln!("  {:?} [{:.1} .. {:.1}]", a.state, a.start, a.end);
    }
    eprintln!(
        "out_of_hp={} remaining_to_finish={:?}",
        focus.out_of_hp, focus.out_of_hp_position
    );

    let finish_order: Vec<&str> = race
        .finished_runners()
        .iter()
        .map(|id| {
            race.runners()
                .iter()
                .find(|r| r.id == *id)
                .map_or("?", |r| r.name.as_str())
        })
        .collect();
    eprintln!("finish order: {finish_order:?}");
    let focus_finish = focus.finish_time;
    let winner_finish = race
        .runners()
        .iter()
        .find(|r| r.id == race.finished_runners()[0])
        .map_or(0.0, |r| r.finish_time);
    eprintln!(
        "focus finish_time={focus_finish:.3}s; winner={winner_finish:.3}s; delta={:.3}s",
        focus_finish - winner_finish
    );

    // Classification aids (printed, not hard gates — seed/field variance is high).
    let early = snaps
        .iter()
        .find(|s| s.section == 3)
        .expect("section 3 snapshot");
    eprintln!(
        "section-3 gap_to_leader={:.1}m (G accel is 0.4× A; expect modest lag, not 50–80m)",
        early.gap_to_leader
    );

    if let Some(mid) = snaps.iter().find(|s| s.section == 8) {
        eprintln!(
            "section-8 gap_to_leader={:.1}m pk={:?} coef={:.3}",
            mid.gap_to_leader, mid.pos_keep, mid.pos_keep_coef
        );
    }

    let pace_up_ex_spans: Vec<_> = focus
        .position_keep_activations
        .iter()
        .filter(|a| a.state == PositionKeepState::PaceUpEx)
        .collect();
    eprintln!("PaceUpEx activations: {}", pace_up_ex_spans.len());
    for a in &pace_up_ex_spans {
        eprintln!("  PaceUpEx [{:.1} .. {:.1}]", a.start, a.end);
    }

    // Contested engine ends position-keep at section_length * 10 (canon sections 1–10).
    assert!(
        (pos_keep_end - section_length * 10.0).abs() < 0.1,
        "contested pos_keep_end should be 10× section; got {pos_keep_end}"
    );
}
