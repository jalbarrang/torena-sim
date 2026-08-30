//! Gates for skill activation order.
//!
//! The game checks skill activations in id order (mechanics § activate_count_x),
//! and captured races bear that out: across 1454 activations, every in-race
//! frame that fired more than one skill for one runner emitted them in
//! ascending id order.
//!
//! The engine used to inherit whatever order the caller supplied. That made the
//! documented rule a precondition nobody stated, and it was not only about
//! same-frame trigger chains: the step kernel draws each trigger's random
//! activation region from the shared skill PRNG while walking the skill vector,
//! so a permuted vector also reshuffles which skill gets which random region.
//!
//! Two properties matter here.
//!
//! 1. **Sorted on construction.** A runner's skills end up in ascending id
//!    order whatever order they arrived in, compared numerically rather than
//!    lexicographically.
//! 2. **Order independence.** Two compare runs whose only difference is the
//!    input order of one runner's skills produce identical telemetry. This is
//!    the property that fails loudly if the sort is ever dropped.

use std::collections::HashMap;

use honse_sim::contested::{Race, SimulationSettings};
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
use honse_sim::vacuum::simulation::{run_compare, CompareSimParams};
use honse_sim::vacuum::SimulationSettings as VacuumSettings;

const SEED: u64 = 91_337;
const SAMPLES: usize = 12;

const DUELING_RATES: DuelingRates = DuelingRates {
    runaway: 10.0,
    front_runner: 10.0,
    pace_chaser: 10.0,
    late_surger: 10.0,
    end_closer: 10.0,
};

/// Ids chosen so a lexicographic sort disagrees with a numeric one: `920671`
/// is numerically smaller than `100602211` but sorts after it as text.
const IDS: [&str; 6] = [
    "201601",
    "920671",
    "200331",
    "100602211",
    "201522",
    "110941",
];

/// A skill whose strength is derived from its id, so the six fixtures are
/// distinguishable. Identical skills would make the permutation gate vacuous:
/// reshuffling which skill draws which random region cannot change a race in
/// which every skill does the same thing.
fn skill(id: &str) -> Skill {
    let modifier = 3000.0 + (id.parse::<u64>().unwrap_or(0) % 1000) as f64;
    Skill {
        skill_id: SkillId::new(id),
        rarity: SkillRarity::White,
        tags: vec![],
        alternatives: vec![SkillAlternative {
            // A random trigger, so the skill draws from the shared skill PRNG
            // while the kernel walks the skill vector. A fixed trigger would
            // hide the reshuffling this test exists to catch.
            base_duration: 30000.0,
            cooldown_time: None,
            condition: "phase_random==1".to_owned(),
            precondition: None,
            effects: vec![RawSkillEffect {
                modifier,
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
        forced_rank: vec![],
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
        // Real corners and straights: `straight_random` needs regions to
        // sample from, and a skill that never fires cannot reveal a
        // reordering.
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

fn positions_for(order: &[&str]) -> Vec<Vec<f64>> {
    let data = run_compare(CompareSimParams {
        course: course(),
        ground: GroundCondition::Firm,
        parameters: race_params(),
        settings: VacuumSettings::default(),
        dueling_rates: DUELING_RATES,
        runners: vec![runner(order.iter().map(|id| skill(id)).collect())],
        nsamples: SAMPLES,
        master_seed: SEED,
    })
    .expect("compare run");

    data.rounds
        .iter()
        .map(|round| round.runners[0].position.clone())
        .collect()
}

#[test]
fn skills_are_sorted_by_ascending_numeric_id() {
    let mut race = Race::new(
        course(),
        GroundCondition::Firm,
        SimulationSettings::default(),
        race_params(),
    );
    race.add_runner(runner(IDS.iter().map(|id| skill(id)).collect()));

    let got: Vec<&str> = race.runners()[0]
        .skills
        .iter()
        .map(|s| s.skill_id.as_str())
        .collect();

    assert_eq!(
        got,
        vec![
            "110941",
            "200331",
            "201522",
            "201601",
            "920671",
            "100602211"
        ],
        "skills must be ordered by numeric id, not by insertion or text order"
    );
}

/// The permutation test is only meaningful if the skills actually fire and
/// draw from the skill PRNG. If they ever stop doing so the test would pass for
/// the wrong reason, so prove they move the race before trusting it.
#[test]
fn the_test_skills_actually_change_the_race() {
    let without: Vec<&str> = vec![];
    assert_ne!(
        positions_for(&IDS),
        positions_for(&without),
        "the fixture skills do not affect the race, so the permutation gate would be vacuous"
    );
}

#[test]
fn permuting_the_input_order_does_not_change_the_race() {
    let sorted: Vec<&str> = vec![
        "110941",
        "200331",
        "201522",
        "201601",
        "920671",
        "100602211",
    ];
    let baseline = positions_for(&sorted);

    let mut reversed = sorted.clone();
    reversed.reverse();

    let mut rotated = sorted.clone();
    rotated.rotate_left(2);

    for (label, order) in [
        ("as given", IDS.to_vec()),
        ("reversed", reversed),
        ("rotated", rotated),
    ] {
        assert_eq!(
            positions_for(&order),
            baseline,
            "input order `{label}` changed the race; skills are not being sorted"
        );
    }
}

#[test]
fn a_variant_suffixed_id_sorts_on_its_base() {
    let mut race = Race::new(
        course(),
        GroundCondition::Firm,
        SimulationSettings::default(),
        race_params(),
    );
    race.add_runner(runner(vec![
        skill("200362"),
        skill("200331-2"),
        skill("200331"),
    ]));

    let got: Vec<&str> = race.runners()[0]
        .skills
        .iter()
        .map(|s| s.skill_id.as_str())
        .collect();

    assert_eq!(got, vec!["200331", "200331-2", "200362"]);
}
