//! Gates for the compare-only skill placement isolation.
//!
//! The game draws every skill's pre-race activation region from one skill PRNG
//! while walking the runner's skills in id order, so adding a skill re-rolls the
//! placement of every skill after it. `isolate_skill_rng` is the deliberate
//! compare-path exception: it seeds each skill's placement from
//! `(runner seed, skill id)` instead, so a measured marginal is the skill's and
//! not the whole build's re-roll. The shared stream still advances exactly as
//! before, because runtime value scaling reads it.
//!
//! Two properties matter here.
//!
//! 1. **Off is the game.** With the flag off, adding an earlier-id skill moves a
//!    later-id skill's activation window.
//! 2. **On is the marginal.** With the flag on, that window is identical.
//!
//! Activation *distance* is the signal, not the tick: the window position is the
//! draw under test, while the tick it is reached on moves with the runner's speed.

use std::collections::{BTreeMap, HashMap};

use honse_sim::course::model::{Corner, CourseData, Straight};
use honse_sim::runner::lifecycle::{CreateRunner, RunnerAptitudes};
use honse_sim::runner::mechanics::DuelingRates;
use honse_sim::shared_kernel::ids::SkillId;
use honse_sim::shared_kernel::language::{
    Aptitude, DistanceType, Grade, GroundCondition, Mood, Orientation, Season, Strategy, Surface,
    TimeOfDay, Weather,
};
use honse_sim::shared_kernel::params::{RaceParameters, StatLine};
use honse_sim::skills::effect::{SkillRarity, SkillTarget};
use honse_sim::skills::model::{RawSkillEffect, Skill, SkillAlternative};
use honse_sim::vacuum::simulation::{run_basin_compare, CompareSimParams};
use honse_sim::vacuum::SimulationSettings;

const SEED: u64 = 42_424;
const SAMPLES: usize = 12;
/// The skill under measurement; the added skill's id sorts before it.
const MEASURED: &str = "201462";
const ADDED: &str = "201461";

const DUELING_RATES: DuelingRates = DuelingRates {
    runaway: 10.0,
    front_runner: 10.0,
    pace_chaser: 10.0,
    late_surger: 10.0,
    end_closer: 10.0,
};

/// An `all_corner_random` speed skill: its placement is a pure draw from the
/// corner regions, so the only thing that can move it is the RNG stream.
fn skill(id: &str) -> Skill {
    Skill {
        skill_id: SkillId::new(id),
        rarity: SkillRarity::White,
        tags: vec![],
        activate_lot: None,
        level: 1,
        alternatives: vec![SkillAlternative {
            base_duration: 30000.0,
            // A real corner skill's cooldown. `all_corner_random` arms up to four
            // triggers; a cooldown skill keeps the later ones armed, which keeps
            // this test on the placement rather than the trigger count.
            cooldown_time: Some(5_000_000.0),
            condition: "all_corner_random==1".to_owned(),
            precondition: None,
            effects: vec![RawSkillEffect {
                modifier: 2500.0,
                target: SkillTarget::SelfTarget,
                effect_type: 27, // TargetSpeed
                value_usage: None,
                value_level_usage: None,
                pre_applied_multiplier: None,
            }],
        }],
    }
}

fn runner(skills: Vec<Skill>) -> CreateRunner {
    CreateRunner {
        outfit_id: "100302".to_owned(),
        name: "Subject".to_owned(),
        mood: Mood::Great,
        strategy: Strategy::FrontRunner,
        popularity: 0,
        team: None,
        aptitudes: RunnerAptitudes {
            distance: Aptitude::A,
            strategy: Aptitude::A,
            surface: Aptitude::A,
        },
        stats: StatLine {
            speed: 1200,
            stamina: 900,
            power: 800,
            guts: 400,
            wit: 1000,
        },
        skills,
        forced_positions: HashMap::new(),
        injected_debuffs: vec![],
        forced_rushed_regions: vec![],
        forced_dueling_regions: vec![],
        forced_spot_struggle_regions: vec![],
        forced_downhill_regions: vec![],
        forced_rank: vec![],
        gate: None,
        forced_start_delay: None,
        forced_last_spurt_distance: None,
    }
}

fn course() -> CourseData {
    CourseData {
        course_id: 1,
        race_track_id: 10001,
        distance: 1600.0,
        distance_type: DistanceType::Mile,
        surface: Surface::Turf,
        turn: Orientation::Clockwise,
        course_set_status: vec![],
        corners: vec![
            Corner {
                start: 400.0,
                length: 200.0,
            },
            Corner {
                start: 1000.0,
                length: 200.0,
            },
        ],
        straights: vec![
            Straight {
                start: 0.0,
                end: 400.0,
                front_type: 1,
            },
            Straight {
                start: 600.0,
                end: 1000.0,
                front_type: 2,
            },
            Straight {
                start: 1200.0,
                end: 1600.0,
                front_type: 1,
            },
        ],
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

fn race_params() -> RaceParameters {
    RaceParameters {
        ground: GroundCondition::Firm,
        weather: Weather::Sunny,
        season: Season::Spring,
        time_of_day: TimeOfDay::Midday,
        grade: Grade::G1,
        num_umas: Some(1),
        order_ranges: None,
        skill_id: None,
        strategy_counts: None,
        common_skills: None,
    }
}

/// `MEASURED`'s first activation distance and activation count, per round seed.
/// Keyed by seed because a failed wit roll can leave a round without the skill,
/// and dropping it would misalign the rest of the comparison.
fn measured_rounds(isolated: bool, skills: &[&str]) -> BTreeMap<u64, (f64, usize)> {
    let data = run_basin_compare(CompareSimParams {
        course: course(),
        ground: GroundCondition::Firm,
        parameters: race_params(),
        settings: SimulationSettings {
            isolate_skill_rng: isolated,
            // The per-skill wit roll is a separate stream: a failed roll would
            // drop a trigger and make this test measure the wrong thing.
            wit_checks: false,
            ..SimulationSettings::default()
        },
        dueling_rates: DUELING_RATES,
        runners: vec![runner(skills.iter().map(|id| skill(id)).collect())],
        focus_count: 1,
        nsamples: SAMPLES,
        master_seed: SEED,
    })
    .expect("basin compare run");

    data.rounds
        .iter()
        .filter_map(|round| {
            let logs = round.runners[0].skill_activations.get(MEASURED)?;
            let first = logs.first()?;
            Some((round.seed, (first.start, logs.len())))
        })
        .collect()
}

/// With the flag off, an earlier-id skill consumes a draw the measured skill
/// needs, so its window moves — the behaviour the game has and the report hit.
#[test]
fn shared_stream_rerolls_a_later_skill() {
    let alone = measured_rounds(false, &[MEASURED]);
    let with_added = measured_rounds(false, &[ADDED, MEASURED]);

    let common: Vec<u64> = alone
        .keys()
        .filter(|seed| with_added.contains_key(seed))
        .copied()
        .collect();
    assert!(
        common.len() > 1,
        "the measured skill must activate in several common rounds, got {}",
        common.len()
    );
    let moved = common
        .iter()
        .filter(|seed| {
            let (left, _) = alone[*seed];
            let (right, _) = with_added[*seed];
            (left - right).abs() > 10.0
        })
        .count();
    assert!(
        moved > 0,
        "without isolation an earlier skill must move the measured window; \
         all {} common rounds matched",
        common.len()
    );
}

/// With the flag on, the measured window is identical whether or not another
/// skill joins the build.
#[test]
fn isolation_keeps_a_skill_window_across_builds() {
    let alone = measured_rounds(true, &[MEASURED]);
    let with_added = measured_rounds(true, &[ADDED, MEASURED]);

    let common: Vec<u64> = alone
        .keys()
        .filter(|seed| with_added.contains_key(seed))
        .copied()
        .collect();
    assert!(
        common.len() > 1,
        "the measured skill must activate in several common rounds, got {}",
        common.len()
    );
    for seed in common {
        let (left, left_count) = alone[&seed];
        let (right, right_count) = with_added[&seed];
        assert_eq!(
            left_count, right_count,
            "round {seed}: isolation changed how many times the skill fired"
        );
        // The window is the same draw; only the frame it is reached on moves,
        // which is at most one frame of travel at race speed.
        assert!(
            (left - right).abs() < 3.0,
            "round {seed}: isolated window moved {left:.3}m -> {right:.3}m"
        );
    }
}
