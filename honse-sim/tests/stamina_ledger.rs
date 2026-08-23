//! Gates for the stamina HP ledger.
//!
//! Two properties matter and are easy to break:
//!
//! 1. **Reproduction.** Adding attribution must not perturb the race. A seeded
//!    round has to produce the same HP series, finish times, and finish order
//!    it produced before the ledger existed. The arithmetic in
//!    `hp_per_second_at` is written in the applied case's operation order for
//!    exactly this reason — float multiplication is not associative.
//! 2. **Arithmetic.** With no status cause ever active the baseline equals the
//!    total drain, and a downhill-only race saves exactly 60% of its baseline
//!    (downhill multiplies drain by `0.4`).

use std::collections::HashMap;

use honse_sim::contested::{Race, SimulationSettings};
use honse_sim::course::model::CourseData;
use honse_sim::events::RunnerObservation;
use honse_sim::runner::lifecycle::{CreateRunner, RunnerAptitudes};
use honse_sim::shared_kernel::language::{
    Aptitude, DistanceType, Grade, GroundCondition, Mood, Orientation, Phase, Season, Strategy,
    Surface, TimeOfDay, Weather,
};
use honse_sim::shared_kernel::params::{RaceParameters, StatLine};
use honse_sim::shared_kernel::rng::Xoshiro256StarStar;
use honse_sim::skills::effect::PositionKeepState;
use honse_sim::stamina::game_policy::GameStaminaPolicy;
use honse_sim::stamina::policy::{RaceStateSlice, SpeedContributions, StaminaPolicy, StaminaStats};

const FRAME_DT: f64 = 1.0 / 15.0;
const SEED: u64 = 575_032;

fn race_params() -> RaceParameters {
    RaceParameters {
        ground: GroundCondition::Good,
        weather: Weather::Sunny,
        season: Season::Spring,
        time_of_day: TimeOfDay::Midday,
        grade: Grade::G1,
        num_umas: Some(3),
        order_range: None,
        skill_id: None,
        strategy_counts: None,
        common_skills: None,
    }
}

fn runner(name: &str, strategy: Strategy, stamina: i32) -> CreateRunner {
    CreateRunner {
        outfit_id: "100302".to_owned(),
        name: name.to_owned(),
        mood: Mood::Great,
        strategy,
        popularity: 0,
        team: None,
        aptitudes: RunnerAptitudes {
            distance: Aptitude::A,
            strategy: Aptitude::A,
            surface: Aptitude::A,
        },
        stats: StatLine {
            speed: 1200,
            stamina,
            power: 1000,
            guts: 500,
            wit: 900,
        },
        skills: vec![],
        forced_positions: HashMap::new(),
        injected_debuffs: vec![],
        forced_rushed_regions: vec![],
        forced_dueling_regions: vec![],
        forced_spot_struggle_regions: vec![],
        forced_rank: vec![],
    }
}

/// A small three-runner field on a flat 2000m. Enough to drain HP and finish;
/// deliberately not the pacing repro's field, which exists to test something
/// else and would couple these gates to its tuning.
fn build_race() -> Race {
    let mut race = Race::new(
        flat_course(),
        GroundCondition::Good,
        SimulationSettings::default(),
        race_params(),
    );
    race.add_runner(runner("Front", Strategy::FrontRunner, 700));
    race.add_runner(runner("Pace", Strategy::PaceChaser, 600));
    race.add_runner(runner("Late", Strategy::LateSurger, 500));
    race
}

fn flat_course() -> CourseData {
    CourseData {
        course_id: 1,
        race_track_id: 10001,
        distance: 2000.0,
        distance_type: DistanceType::Mid,
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

fn policy() -> GameStaminaPolicy {
    let mut policy = GameStaminaPolicy::new(
        &flat_course(),
        GroundCondition::Firm,
        Box::new(Xoshiro256StarStar::from_u64_seed(1)),
    );
    policy.init(&StaminaStats {
        strategy: Strategy::PaceChaser,
        stamina: 1000.0,
        guts: 400.0,
        wit: 600.0,
    });
    policy
}

fn neutral_state() -> RaceStateSlice {
    RaceStateSlice {
        phase: Phase::MidRace,
        position_keep_state: PositionKeepState::None,
        is_rushed: false,
        is_downhill_mode: false,
        in_spot_struggle: false,
        pos_keep_strategy: None,
        pos: 500.0,
        current_speed: 20.0,
        speed_contributions: SpeedContributions::default(),
    }
}

/// Relative comparison — these are accumulated sums of many float products.
fn assert_close(actual: f64, expected: f64, what: &str) {
    let tolerance = expected.abs().max(1.0) * 1e-9;
    assert!(
        (actual - expected).abs() <= tolerance,
        "{what}: expected {expected}, got {actual}"
    );
}

#[test]
fn with_no_status_cause_the_baseline_equals_the_total_drain() {
    let mut policy = policy();
    let state = neutral_state();

    for _ in 0..300 {
        policy.tick(&state, FRAME_DT);
    }

    let ledger = policy.ledger().expect("game policy records a ledger");
    assert_close(
        ledger.baseline_spent,
        ledger.total_spent,
        "baseline vs total with no cause active",
    );
    assert_eq!(ledger.downhill, 0.0);
    assert_eq!(ledger.rushed, 0.0);
    assert_eq!(ledger.spot_struggle, 0.0);
    assert_eq!(ledger.pace_down, 0.0);
}

#[test]
fn a_downhill_only_race_saves_sixty_percent_of_its_baseline() {
    let mut policy = policy();
    let state = RaceStateSlice {
        is_downhill_mode: true,
        ..neutral_state()
    };

    for _ in 0..300 {
        policy.tick(&state, FRAME_DT);
    }

    let ledger = policy.ledger().expect("game policy records a ledger");

    // Downhill multiplies drain by 0.4, so it spends 40% of baseline and the
    // attribution is the missing 60%, recorded as a negative (a saving).
    assert_close(
        ledger.total_spent,
        ledger.baseline_spent * 0.4,
        "downhill spend",
    );
    assert_close(
        ledger.downhill,
        -ledger.baseline_spent * 0.6,
        "downhill saving",
    );
    assert!(
        ledger.downhill < 0.0,
        "a saving is negative, got {}",
        ledger.downhill
    );
}

#[test]
fn dueling_costs_hp_even_though_it_touches_no_consumption_multiplier() {
    let mut policy = policy();
    // Dueling adds speed and nothing else. Drain is quadratic in speed, so the
    // extra burn is real and must not read as zero.
    let state = RaceStateSlice {
        speed_contributions: SpeedContributions {
            dueling: 0.35,
            ..SpeedContributions::default()
        },
        ..neutral_state()
    };

    for _ in 0..300 {
        policy.tick(&state, FRAME_DT);
    }

    let ledger = policy.ledger().expect("game policy records a ledger");

    assert!(
        ledger.dueling > 0.0,
        "dueling should cost HP through speed, got {}",
        ledger.dueling
    );
    // No multiplier is involved, so the whole gap between what was spent and the
    // neutral baseline is the speed it asked for.
    assert_close(
        ledger.dueling,
        ledger.total_spent - ledger.baseline_spent,
        "dueling is the entire excess",
    );
    assert_eq!(ledger.rushed, 0.0);
    assert_eq!(ledger.spot_struggle, 0.0);
}

#[test]
fn pacing_up_costs_hp_and_pacing_down_saves_it() {
    let up = {
        let mut policy = policy();
        let state = RaceStateSlice {
            position_keep_state: PositionKeepState::PaceUp,
            speed_contributions: SpeedContributions {
                position_keep: 0.8,
                ..SpeedContributions::default()
            },
            ..neutral_state()
        };
        for _ in 0..300 {
            policy.tick(&state, FRAME_DT);
        }
        *policy.ledger().expect("ledger")
    };

    assert!(
        up.pace_up > 0.0,
        "pacing up burns extra HP, got {}",
        up.pace_up
    );
    assert_eq!(up.pace_down, 0.0, "pace-up must not be booked as pace-down");

    let down = {
        let mut policy = policy();
        // Pace-down both slows the runner and applies a 0.6 consumption
        // multiplier; the contribution is negative because it removes speed.
        let state = RaceStateSlice {
            position_keep_state: PositionKeepState::PaceDown,
            speed_contributions: SpeedContributions {
                position_keep: -0.9,
                ..SpeedContributions::default()
            },
            ..neutral_state()
        };
        for _ in 0..300 {
            policy.tick(&state, FRAME_DT);
        }
        *policy.ledger().expect("ledger")
    };

    assert!(
        down.pace_down < 0.0,
        "pacing down saves HP, got {}",
        down.pace_down
    );
    assert_eq!(down.pace_up, 0.0, "pace-down must not be booked as pace-up");
}

#[test]
fn a_mechanic_with_both_channels_is_priced_for_both_at_once() {
    let mut policy = policy();
    // Spot-struggle multiplies drain by 1.4 AND adds speed. One counterfactual
    // removes the whole mechanic, so its amount exceeds the multiplier alone.
    let state = RaceStateSlice {
        in_spot_struggle: true,
        speed_contributions: SpeedContributions {
            spot_struggle: 0.5,
            ..SpeedContributions::default()
        },
        ..neutral_state()
    };

    for _ in 0..300 {
        policy.tick(&state, FRAME_DT);
    }

    let ledger = policy.ledger().expect("game policy records a ledger");
    let multiplier_only = ledger.baseline_spent * (1.4 - 1.0);

    assert!(
        ledger.spot_struggle > multiplier_only,
        "the speed boost must be priced too: {} should exceed {}",
        ledger.spot_struggle,
        multiplier_only
    );
}

#[test]
fn the_baseline_excludes_speed_that_mechanics_supplied() {
    let mut with_bonus = policy();
    let bonus_state = RaceStateSlice {
        speed_contributions: SpeedContributions {
            dueling: 0.6,
            ..SpeedContributions::default()
        },
        ..neutral_state()
    };
    for _ in 0..300 {
        with_bonus.tick(&bonus_state, FRAME_DT);
    }

    let mut without = policy();
    let plain = RaceStateSlice {
        current_speed: neutral_state().current_speed - 0.6,
        ..neutral_state()
    };
    for _ in 0..300 {
        without.tick(&plain, FRAME_DT);
    }

    // "What you would have spent with no mechanic at all" must not silently
    // include the speed a mechanic handed you.
    assert_close(
        with_bonus.ledger().expect("ledger").baseline_spent,
        without.ledger().expect("ledger").total_spent,
        "baseline strips mechanic speed",
    );
}

#[test]
fn overlapping_causes_are_priced_against_each_other_not_partitioned() {
    let mut policy = policy();
    // Rushed inside a spot-struggle: the applied modifier is 3.6, while rushed
    // alone is 1.6 and spot-struggle alone is 1.4.
    let state = RaceStateSlice {
        is_rushed: true,
        in_spot_struggle: true,
        ..neutral_state()
    };

    for _ in 0..300 {
        policy.tick(&state, FRAME_DT);
    }

    let ledger = policy.ledger().expect("game policy records a ledger");
    let base = ledger.baseline_spent;

    assert_close(ledger.total_spent, base * 3.6, "combined spend");
    // Suppressing rushed leaves plain spot-struggle at 1.4.
    assert_close(ledger.rushed, base * (3.6 - 1.4), "rushed attribution");
    // Suppressing spot-struggle leaves plain rushed at 1.6.
    assert_close(
        ledger.spot_struggle,
        base * (3.6 - 1.6),
        "spot-struggle attribution",
    );
    // The point of Decision 2: the parts overshoot the excess, so they are
    // attributions rather than slices of a whole.
    let excess = ledger.total_spent - base;
    assert!(
        ledger.rushed + ledger.spot_struggle > excess,
        "counterfactual parts should not partition the excess"
    );
}

#[test]
fn recovery_books_the_clamped_delta_and_a_drain_is_not_negative_recovery() {
    let mut policy = policy();
    let state = neutral_state();
    for _ in 0..300 {
        policy.tick(&state, FRAME_DT);
    }

    // Heal far past the top of the bar: only the clamped delta counts.
    let missing = {
        let ledger = policy.ledger().expect("ledger");
        ledger.max_hp - policy.current_health()
    };
    policy.recover(10.0);
    let after_heal = policy.ledger().expect("ledger").total_recovered;
    assert_close(after_heal, missing, "clamped recovery delta");
    assert_eq!(policy.ledger().expect("ledger").recovery_procs, 1);

    // A negative modifier is an HP-drain debuff, booked separately.
    policy.recover(-0.1);
    let ledger = policy.ledger().expect("ledger");
    assert_eq!(ledger.recovery_procs, 1, "a drain is not a recovery proc");
    assert!(ledger.total_drained_by_effects > 0.0);
    assert_close(
        after_heal,
        ledger.total_recovered,
        "recovery unchanged by a drain",
    );
}

/// Captured from the engine **before** the ledger existed, by running this same
/// race on a tree with `honse-sim/src` stashed. Bit-exact: if attribution ever
/// perturbs the simulation, these move and this test fails.
const GOLDEN: [(&str, f64, f64); 3] = [
    ("Front", 9.673_333_333_333_296e1, 1.186_382_288_763_916_3e1),
    ("Late", 9.713_333_333_333_294e1, -7.239_326_872_221_477e1),
    ("Pace", 9.699_999_999_999_962e1, -5.677_333_779_574_945_5e1),
];
const GOLDEN_ORDER: [&str; 3] = ["Front", "Pace", "Late"];

#[test]
fn a_seeded_round_reproduces_the_pre_ledger_engine_exactly() {
    let mut race = build_race();
    race.prepare_round(SEED);
    race.run();

    let mut rows: Vec<(String, f64, f64)> = race
        .runners()
        .iter()
        .map(|r| (r.name.clone(), r.finish_time(), r.current_health()))
        .collect();
    rows.sort_by(|a, b| a.0.cmp(&b.0));

    for (row, expected) in rows.iter().zip(GOLDEN.iter()) {
        assert_eq!(row.0, expected.0, "runner order in the comparison");
        assert_eq!(
            row.1.to_bits(),
            expected.1.to_bits(),
            "{} finish time drifted: {} vs {}",
            row.0,
            row.1,
            expected.1
        );
        assert_eq!(
            row.2.to_bits(),
            expected.2.to_bits(),
            "{} final HP drifted: {} vs {}",
            row.0,
            row.2,
            expected.2
        );
    }

    let order: Vec<String> = race
        .finished_runners()
        .iter()
        .map(|id| {
            race.runners()
                .iter()
                .find(|r| r.id == *id)
                .expect("finisher present")
                .name
                .clone()
        })
        .collect();
    assert_eq!(order, GOLDEN_ORDER, "finish order drifted");
}

#[test]
fn every_runner_in_a_full_race_reports_a_coherent_ledger() {
    let mut race = build_race();
    race.prepare_round(SEED);
    race.run();

    for runner in race.runners() {
        let ledger = runner
            .stamina_ledger()
            .expect("the game policy records a ledger");

        assert!(ledger.max_hp > 0.0, "max hp is set from init");
        assert!(ledger.total_spent > 0.0, "a finished race drains HP");
        assert!(ledger.baseline_spent > 0.0, "baseline accumulates too");
        assert!(
            ledger.total_recovered >= 0.0 && ledger.total_drained_by_effects >= 0.0,
            "recovery and effect drain are both magnitudes"
        );

        // The HP bar has to balance: what you started with, minus what you
        // spent, plus what you got back, is what you finished with.
        let expected = ledger.max_hp - ledger.total_spent + ledger.total_recovered
            - ledger.total_drained_by_effects;
        assert_close(
            runner.current_health(),
            expected,
            &format!("{} HP balance", runner.name),
        );
    }
}
