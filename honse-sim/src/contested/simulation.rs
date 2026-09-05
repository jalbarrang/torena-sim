//! The `run_race_sim` use case + its params / result value objects.
//!
//! Port of `race-sim/run-race-sim.ts`. Orchestrates the [`Race`] aggregate over
//! `nsamples` rounds, attaching the read-model [`RaceSimDataCollector`] as an
//! observer, and returns the per-round finish orders plus collected telemetry.

use crate::contested::collectors::{
    CollectedData, RaceEventLog, RaceEventLogCollector, RaceSimDataCollector,
};
use crate::contested::race::{Race, SimulationSettings};
use crate::contested::replay::{RaceReplay, RaceReplayCollector};
use uma_sim_primitives::compare::{CompareData, CompareDataCollector};
use uma_sim_primitives::course::model::CourseData;
use uma_sim_primitives::mob::{generate_mob_runners, CONTESTED_FILL_MOB_STATS};
use uma_sim_primitives::runner::lifecycle::CreateRunner;
use uma_sim_primitives::shared_kernel::ids::RunnerId;
use uma_sim_primitives::shared_kernel::language::{GroundCondition, Strategy};
use uma_sim_primitives::shared_kernel::params::RaceParameters;

/// The smallest field a race can be run with.
pub const MIN_FIELD_SIZE: usize = 2;

/// The largest field a race can be run with.
pub const MAX_FIELD_SIZE: usize = 12;

/// The field size a standard race uses when the caller has no preference.
pub const DEFAULT_FIELD_SIZE: usize = 9;

/// Inputs to [`run_race_sim`].
pub struct RaceSimParams {
    /// The course to race.
    pub course: CourseData,
    /// Ground condition.
    pub ground: GroundCondition,
    /// Race-wide parameters.
    pub parameters: RaceParameters,
    /// Simulation settings (mode, toggles, sample budget).
    pub settings: SimulationSettings,
    /// The field to race, [`MIN_FIELD_SIZE`]..=[`MAX_FIELD_SIZE`] runners.
    pub runners: Vec<CreateRunner>,
    /// Number of rounds to simulate.
    pub nsamples: usize,
    /// Master seed (round `i` uses `master_seed + i`).
    pub master_seed: u64,
    /// Runner ids whose per-tick telemetry is captured.
    pub focus_runner_ids: Vec<RunnerId>,
}

/// Inputs to [`run_contested_compare`].
pub struct ContestedCompareParams {
    /// The course to race.
    pub course: CourseData,
    /// Ground condition.
    pub ground: GroundCondition,
    /// Race-wide parameters.
    pub parameters: RaceParameters,
    /// Simulation settings (contested mechanics toggles).
    pub settings: SimulationSettings,
    /// Compared runners, added first and captured by the compare collector.
    pub runners: Vec<CreateRunner>,
    /// When `Some(n)`, pad the field with generated mobs to exactly `n`
    /// runners (`runners.len()..=MAX_FIELD_SIZE`; `n == runners.len()` is
    /// an accepted no-op). `None` runs only the compared runners.
    pub fill_to: Option<usize>,
    /// Flat stat line for fill mobs. `None` uses
    /// [`CONTESTED_FILL_MOB_STATS`] (600).
    pub mob_stats: Option<i32>,
    /// Number of rounds to simulate.
    pub nsamples: usize,
    /// Master seed (round `i` uses `master_seed + i`).
    pub master_seed: u64,
}

/// One runner's finishing record for a round.
#[derive(Debug, Clone, PartialEq)]
pub struct FinishEntry {
    /// The finishing runner.
    pub runner_id: RunnerId,
    /// Display name.
    pub name: String,
    /// Running style.
    pub strategy: Strategy,
    /// Final longitudinal position in meters.
    pub finish_position: f64,
    /// Finish time in seconds.
    pub finish_time: f64,
}

/// The result of a simulation run.
#[derive(Debug, Clone, PartialEq)]
pub struct RaceSimResult {
    /// Finish order per round (index 0 = winner).
    pub finish_orders: Vec<Vec<FinishEntry>>,
    /// Collected focus-runner telemetry.
    pub collected: CollectedData,
    /// Per-round logged race events (state-transition projection).
    pub event_logs: RaceEventLog,
    /// Per-round replays in the game's own result shape.
    pub replays: Vec<RaceReplay>,
}

/// Errors raised validating / running a simulation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SimError {
    /// `nsamples` must be a positive integer.
    InvalidSamples,
    /// The field must hold [`MIN_FIELD_SIZE`]..=[`MAX_FIELD_SIZE`] runners.
    WrongRunnerCount(usize),
    /// Contested compare requires [`MIN_FIELD_SIZE`]..=[`MAX_FIELD_SIZE`] compared runners.
    ContestedRunnerCount(usize),
    /// `fill_to` must be within `runners.len()..=MAX_FIELD_SIZE`.
    ContestedFillTo {
        /// The rejected `fill_to` value.
        fill_to: usize,
        /// The compared runner count.
        runners: usize,
    },
}

impl std::fmt::Display for SimError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SimError::InvalidSamples => write!(f, "nsamples must be a positive integer"),
            SimError::WrongRunnerCount(n) => {
                write!(
                    f,
                    "run_race_sim expects {MIN_FIELD_SIZE}..={MAX_FIELD_SIZE} runners, got {n}"
                )
            }
            SimError::ContestedRunnerCount(n) => write!(
                f,
                "run_contested_compare expects {MIN_FIELD_SIZE}..={MAX_FIELD_SIZE} compared runners, got {n}"
            ),
            SimError::ContestedFillTo { fill_to, runners } => write!(
                f,
                "fill_to must be within {runners}..={MAX_FIELD_SIZE} (compared runners..=max field), got {fill_to}"
            ),
        }
    }
}

impl std::error::Error for SimError {}

/// Run a race simulation over `nsamples` rounds.
///
/// Constructs the [`Race`] aggregate, adds the runners, attaches the telemetry
/// collector, and runs `nsamples` rounds with seeds `master_seed + i`. Returns
/// the per-round finish orders + collected data.
pub fn run_race_sim(params: RaceSimParams) -> Result<RaceSimResult, SimError> {
    if params.nsamples == 0 {
        return Err(SimError::InvalidSamples);
    }
    if !(MIN_FIELD_SIZE..=MAX_FIELD_SIZE).contains(&params.runners.len()) {
        return Err(SimError::WrongRunnerCount(params.runners.len()));
    }

    let mut race = Race::new(
        params.course,
        params.ground,
        params.settings,
        params.parameters,
    );
    for runner in params.runners {
        race.add_runner(runner);
    }

    let collector = RaceSimDataCollector::new(params.focus_runner_ids);
    race.subscribe(collector.handle());
    let event_log = RaceEventLogCollector::new();
    race.subscribe(event_log.handle());
    let replay = RaceReplayCollector::new();
    race.subscribe(replay.handle());

    let mut finish_orders: Vec<Vec<FinishEntry>> = Vec::with_capacity(params.nsamples);
    for i in 0..params.nsamples {
        race.prepare_round(params.master_seed + i as u64);
        race.run();
        finish_orders.push(collect_finish_order(&race));
    }

    Ok(RaceSimResult {
        finish_orders,
        collected: collector.result(),
        event_logs: event_log.result(),
        replays: replay.result(),
    })
}

/// Run a same-race compare over `nsamples` contested rounds.
///
/// Compared runners are added first and are the only runners captured by the
/// compare collector. When `fill_to` is `Some(n)`, generated mob runners pad
/// the field to exactly `n` so field-dependent mechanics can emerge around the
/// compared runners without increasing compare payload size.
pub fn run_contested_compare(params: ContestedCompareParams) -> Result<CompareData, SimError> {
    if params.nsamples == 0 {
        return Err(SimError::InvalidSamples);
    }
    let nsamples = params.nsamples;
    let master_seed = params.master_seed;
    let (mut race, focus_runner_ids) = build_contested_race(params)?;

    let collector = CompareDataCollector::for_runner_ids(focus_runner_ids);
    race.subscribe(collector.handle());

    for i in 0..nsamples {
        race.prepare_round(master_seed + i as u64);
        race.run();
    }

    Ok(collector.result())
}

/// Validate contested params and construct the race field: compared runners
/// first (their ids become the compare focus), then mob padding to `fill_to`.
fn build_contested_race(params: ContestedCompareParams) -> Result<(Race, Vec<RunnerId>), SimError> {
    if !(MIN_FIELD_SIZE..=MAX_FIELD_SIZE).contains(&params.runners.len()) {
        return Err(SimError::ContestedRunnerCount(params.runners.len()));
    }
    if let Some(fill_to) = params.fill_to {
        if !(params.runners.len()..=MAX_FIELD_SIZE).contains(&fill_to) {
            return Err(SimError::ContestedFillTo {
                fill_to,
                runners: params.runners.len(),
            });
        }
    }

    let mut race = Race::new(
        params.course,
        params.ground,
        params.settings,
        params.parameters,
    );
    let mut focus_runner_ids = Vec::with_capacity(params.runners.len());
    for runner in params.runners {
        focus_runner_ids.push(race.add_runner(runner));
    }

    if let Some(fill_to) = params.fill_to {
        let open_slots = fill_to - focus_runner_ids.len();
        let mob_stats = params.mob_stats.unwrap_or(CONTESTED_FILL_MOB_STATS);
        for mob in generate_mob_runners(open_slots, mob_stats) {
            race.add_runner(mob);
        }
    }

    Ok((race, focus_runner_ids))
}

/// Build the finish order for the just-completed round.
fn collect_finish_order(race: &Race) -> Vec<FinishEntry> {
    race.finished_runners()
        .iter()
        .filter_map(|&id| {
            race.runners()
                .iter()
                .find(|r| r.id == id)
                .map(|runner| FinishEntry {
                    runner_id: id,
                    name: runner.name.clone(),
                    strategy: runner.strategy,
                    finish_position: runner.position,
                    finish_time: runner.finish_time,
                })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use uma_sim_primitives::mob::generate_mob_field;
    use uma_sim_primitives::runner::lifecycle::RunnerAptitudes;
    use uma_sim_primitives::runner::test_support::{test_course, test_race_params};
    use uma_sim_primitives::shared_kernel::language::{Aptitude, Mood};
    use uma_sim_primitives::shared_kernel::params::StatLine;

    fn params(nsamples: usize) -> RaceSimParams {
        RaceSimParams {
            course: test_course(),
            ground: GroundCondition::Firm,
            parameters: test_race_params(),
            settings: SimulationSettings::default(),
            runners: generate_mob_field(),
            nsamples,
            master_seed: 9001,
            focus_runner_ids: vec![RunnerId(0)],
        }
    }

    fn runner_props(name: &str, strategy: Strategy) -> CreateRunner {
        CreateRunner {
            outfit_id: "100302".to_owned(),
            name: name.to_owned(),
            mood: Mood::Normal,
            strategy,
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
            forced_downhill_regions: vec![],
            forced_rank: vec![],
            gate: None,
            forced_start_delay: None,
            forced_last_spurt_distance: None,
        }
    }

    fn contested_params(
        nsamples: usize,
        runners: Vec<CreateRunner>,
        fill_to: Option<usize>,
    ) -> ContestedCompareParams {
        ContestedCompareParams {
            course: test_course(),
            ground: GroundCondition::Firm,
            parameters: test_race_params(),
            settings: SimulationSettings::default(),
            runners,
            fill_to,
            mob_stats: None,
            nsamples,
            master_seed: 9001,
        }
    }

    #[test]
    fn rejects_invalid_sample_count() {
        assert!(matches!(
            run_race_sim(params(0)),
            Err(SimError::InvalidSamples)
        ));
    }

    #[test]
    fn rejects_field_sizes_outside_the_supported_range() {
        let mut too_small = params(1);
        too_small.runners.truncate(MIN_FIELD_SIZE - 1);
        assert!(matches!(
            run_race_sim(too_small),
            Err(SimError::WrongRunnerCount(1))
        ));

        let mut too_large = params(1);
        let extra = too_large.runners[0].clone();
        too_large.runners.resize(MAX_FIELD_SIZE + 1, extra);
        assert!(matches!(
            run_race_sim(too_large),
            Err(SimError::WrongRunnerCount(13))
        ));
    }

    #[test]
    fn races_any_field_size_within_the_supported_range() {
        for size in [MIN_FIELD_SIZE, DEFAULT_FIELD_SIZE, MAX_FIELD_SIZE] {
            let mut p = params(1);
            let extra = p.runners[0].clone();
            p.runners.resize(size, extra);
            let result = run_race_sim(p)
                .unwrap_or_else(|err| panic!("field of {size} should race, got {err}"));
            assert_eq!(result.finish_orders[0].len(), size);
        }
    }

    #[test]
    fn runs_and_collects_shape() {
        let result = run_race_sim(params(3)).expect("sim runs");
        assert_eq!(result.finish_orders.len(), 3);
        for order in &result.finish_orders {
            assert_eq!(order.len(), DEFAULT_FIELD_SIZE);
            assert!(order[0].finish_time > 0.0);
        }
        // Focus runner 0 traced over each round.
        assert_eq!(result.collected.rounds.len(), 3);
        assert_eq!(result.collected.rounds[0].focus.len(), 1);
        assert!(!result.collected.rounds[0].focus[0].samples.is_empty());
    }

    #[test]
    fn replay_matches_the_finish_order_and_covers_the_whole_field() {
        let distance = params(1).course.distance as f32;
        let result = run_race_sim(params(1)).expect("sim runs");
        let replay = &result.replays[0];
        let order = &result.finish_orders[0];

        assert_eq!(replay.results.len(), DEFAULT_FIELD_SIZE);
        for frame in &replay.frames {
            assert_eq!(frame.horses.len(), DEFAULT_FIELD_SIZE);
        }
        // The winner's row says 0, and its raw time is the finish time.
        let winner = replay.results[order[0].runner_id.0 as usize];
        assert_eq!(winner.finish_order, 0);
        assert!((f64::from(winner.finish_time_raw) - order[0].finish_time).abs() < 1e-3);
        assert_eq!(winner.finish_diff_time, 0.0);
        // Every gate finishes at the line in the last frame.
        let last = replay.frames.last().expect("frames");
        for horse in &last.horses {
            assert_eq!(horse.distance, distance);
        }
        // A nine-horse field has ranks 0..=8 for guts.
        let mut ranks: Vec<u8> = replay.results.iter().map(|r| r.guts_order).collect();
        ranks.sort_unstable();
        assert_eq!(ranks, (0..DEFAULT_FIELD_SIZE as u8).collect::<Vec<_>>());
    }

    #[test]
    fn deterministic_for_same_seed() {
        let a = run_race_sim(params(2)).expect("a");
        let b = run_race_sim(params(2)).expect("b");
        let order_a: Vec<RunnerId> = a.finish_orders[0].iter().map(|e| e.runner_id).collect();
        let order_b: Vec<RunnerId> = b.finish_orders[0].iter().map(|e| e.runner_id).collect();
        assert_eq!(order_a, order_b);
    }

    #[test]
    fn contested_compare_rejects_invalid_runner_count() {
        assert!(matches!(
            run_contested_compare(contested_params(
                1,
                vec![runner_props("solo", Strategy::FrontRunner)],
                None,
            )),
            Err(SimError::ContestedRunnerCount(1))
        ));
    }

    /// `count` compared runners cycling the strategy mix.
    fn field_of(count: usize) -> Vec<CreateRunner> {
        let strategies = [
            Strategy::Runaway,
            Strategy::FrontRunner,
            Strategy::PaceChaser,
            Strategy::LateSurger,
            Strategy::EndCloser,
        ];
        (0..count)
            .map(|i| runner_props(&format!("R{i}"), strategies[i % strategies.len()]))
            .collect()
    }

    #[test]
    fn contested_compare_rejects_thirteen_runners() {
        assert!(matches!(
            run_contested_compare(contested_params(1, field_of(13), None)),
            Err(SimError::ContestedRunnerCount(13))
        ));
    }

    #[test]
    fn contested_compare_rejects_out_of_range_fill_to() {
        for fill_to in [1, 13] {
            assert!(matches!(
                run_contested_compare(contested_params(1, field_of(2), Some(fill_to))),
                Err(SimError::ContestedFillTo {
                    fill_to: f,
                    runners: 2
                }) if f == fill_to
            ));
        }
    }

    #[test]
    fn contested_compare_fill_to_runner_count_is_noop() {
        let data = run_contested_compare(contested_params(1, field_of(2), Some(2)))
            .expect("no-op fill_to accepted");
        assert_eq!(data.rounds[0].runners.len(), 2);
    }

    #[test]
    fn contested_compare_twelve_runner_field_completes() {
        let data = run_contested_compare(contested_params(1, field_of(12), None))
            .expect("12-runner contested compare runs");

        assert_eq!(data.rounds.len(), 1);
        let round = &data.rounds[0];
        assert_eq!(round.runners.len(), 12);
        assert!(round.runners.iter().all(|runner| runner.finished));
        assert!(round
            .runners
            .iter()
            .all(|runner| !runner.position.is_empty()));
    }

    #[test]
    fn contested_compare_deterministic_at_ten_and_twelve() {
        for size in [10, 12] {
            let a = run_contested_compare(contested_params(2, field_of(size), None)).expect("a");
            let b = run_contested_compare(contested_params(2, field_of(size), None)).expect("b");
            assert_eq!(a, b, "field of {size} must be deterministic per seed");
        }
    }

    #[test]
    fn contested_compare_fill_to_twelve_builds_true_twelve_field() {
        // Regression guard: generate_mob_field() only ever produced 9 mobs, so
        // 2 + fill_to(12) silently built an 11-field.
        let (race, focus) =
            build_contested_race(contested_params(1, field_of(2), Some(12))).expect("field builds");
        assert_eq!(focus.len(), 2);
        assert_eq!(race.runners().len(), 12);

        // Telemetry stays scoped to the compared runners.
        let data = run_contested_compare(contested_params(1, field_of(2), Some(12)))
            .expect("contested compare runs");
        assert_eq!(data.rounds[0].runners.len(), 2);
        assert!(data.rounds[0].runners.iter().all(|runner| runner.finished));
    }

    #[test]
    fn contested_compare_twelve_field_assigns_twelve_distinct_gates() {
        // Regression guard: the gate vector was hard-coded to 9 entries and
        // panicked (index out of bounds) beyond 9 runners.
        let (mut race, _) =
            build_contested_race(contested_params(1, field_of(12), None)).expect("field builds");
        race.prepare_round(9001);
        let mut gates: Vec<i64> = race.runners().iter().map(|r| r.gate).collect();
        gates.sort_unstable();
        assert_eq!(gates, (0..12).collect::<Vec<i64>>());
    }

    #[test]
    fn contested_compare_spot_struggle_emerges_in_twelve_field() {
        let mut params = contested_params(
            1,
            vec![
                runner_props("a", Strategy::FrontRunner),
                runner_props("b", Strategy::FrontRunner),
            ],
            Some(12),
        );
        // Narrow lanes keep the front-runner pair close enough for the live
        // group coordinator to activate naturally even in a full 12-field.
        params.course.horse_lane = 0.01;
        let data = run_contested_compare(params).expect("contested compare runs");

        assert!(data.rounds[0]
            .runners
            .iter()
            .any(|runner| runner.spot_struggle_region.is_some()));
    }

    #[test]
    fn contested_compare_runs_two_runner_field() {
        let data = run_contested_compare(contested_params(
            2,
            vec![
                runner_props("a", Strategy::FrontRunner),
                runner_props("b", Strategy::FrontRunner),
            ],
            None,
        ))
        .expect("contested compare runs");

        assert_eq!(data.rounds.len(), 2);
        for round in &data.rounds {
            assert_eq!(round.runners.len(), 2);
            assert_eq!(round.primary_runner_id, Some(0));
            assert!(round.runners.iter().all(|runner| runner.finished));
            assert!(round
                .runners
                .iter()
                .all(|runner| !runner.position.is_empty()));
        }
    }

    #[test]
    fn contested_compare_fill_mobs_keeps_telemetry_to_compared_runners() {
        let data = run_contested_compare(contested_params(
            1,
            vec![
                runner_props("a", Strategy::FrontRunner),
                runner_props("b", Strategy::FrontRunner),
            ],
            Some(DEFAULT_FIELD_SIZE),
        ))
        .expect("contested compare runs");

        assert_eq!(data.rounds.len(), 1);
        assert_eq!(data.rounds[0].runners.len(), 2);
        assert_eq!(data.rounds[0].primary_runner_id, Some(0));
        assert_eq!(data.rounds[0].runners[0].runner_id, 0);
        assert_eq!(data.rounds[0].runners[1].runner_id, 1);
    }

    #[test]
    fn contested_compare_can_surface_natural_spot_struggle() {
        let mut params = contested_params(
            1,
            vec![
                runner_props("a", Strategy::FrontRunner),
                runner_props("b", Strategy::FrontRunner),
            ],
            None,
        );
        // Narrow test course keeps same-strategy front-runners lane-close enough
        // for the live group coordinator to activate naturally.
        params.course.horse_lane = 0.01;
        let data = run_contested_compare(params).expect("contested compare runs");

        assert!(data.rounds[0]
            .runners
            .iter()
            .any(|runner| runner.spot_struggle_region.is_some()));

        // Per-tick race order is recorded for focus runners (1-based rank,
        // aligned with the time/position channels).
        for runner in &data.rounds[0].runners {
            assert_eq!(runner.order.len(), runner.time.len());
            assert!(runner.order.iter().any(|&o| o >= 1));
        }
    }

    #[test]
    fn runaway_spot_struggle_hp_drain_exceeds_front_runner() {
        use uma_sim_primitives::runner::ForcedRegion;

        let mut runaway = runner_props("runaway", Strategy::Runaway);
        runaway.forced_spot_struggle_regions = vec![ForcedRegion {
            start: 300.0,
            end: 500.0,
        }];
        let mut front = runner_props("front", Strategy::FrontRunner);
        front.forced_spot_struggle_regions = vec![ForcedRegion {
            start: 300.0,
            end: 500.0,
        }];

        let data = run_contested_compare(contested_params(1, vec![runaway, front], None))
            .expect("contested compare runs");
        let round = &data.rounds[0];
        let runaway = round
            .runners
            .iter()
            .find(|runner| runner.runner_id == 0)
            .expect("runaway telemetry");
        let front = round
            .runners
            .iter()
            .find(|runner| runner.runner_id == 1)
            .expect("front telemetry");

        fn hp_drain_in_region(position: &[f64], hp: &[f64], start: f64, end: f64) -> f64 {
            let first = position.iter().position(|&pos| pos >= start).unwrap_or(0);
            let last = position
                .iter()
                .rposition(|&pos| pos <= end)
                .unwrap_or(position.len().saturating_sub(1));
            hp[first] - hp[last]
        }

        assert!(runaway.spot_struggle_region.is_some());
        assert!(front.spot_struggle_region.is_some());
        assert!(
            hp_drain_in_region(&runaway.position, &runaway.hp, 300.0, 500.0)
                > hp_drain_in_region(&front.position, &front.hp, 300.0, 500.0)
        );
    }
}
