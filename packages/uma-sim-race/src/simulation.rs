//! The `run_race_sim` use case + its params / result value objects.
//!
//! Port of `race-sim/run-race-sim.ts`. Orchestrates the [`Race`] aggregate over
//! `nsamples` rounds, attaching the read-model [`RaceSimDataCollector`] as an
//! observer, and returns the per-round finish orders plus collected telemetry.

use crate::collectors::{CollectedData, RaceEventLog, RaceEventLogCollector, RaceSimDataCollector};
use crate::race::{Race, SimulationSettings};
use uma_sim_primitives::compare::{CompareData, CompareDataCollector};
use uma_sim_primitives::course::model::CourseData;
use uma_sim_primitives::mob::generate_mob_field;
use uma_sim_primitives::runner::lifecycle::CreateRunner;
use uma_sim_primitives::shared_kernel::ids::RunnerId;
use uma_sim_primitives::shared_kernel::language::{GroundCondition, Strategy};
use uma_sim_primitives::shared_kernel::params::RaceParameters;

/// The number of runners a standard race expects.
pub const FIELD_SIZE: usize = 9;

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
    /// The 9 runners to race.
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
    /// Whether to fill the remaining field slots with generated mobs.
    pub fill_mobs: bool,
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
}

/// Errors raised validating / running a simulation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SimError {
    /// `nsamples` must be a positive integer.
    InvalidSamples,
    /// The field must contain exactly [`FIELD_SIZE`] runners.
    WrongRunnerCount(usize),
    /// Contested compare requires 2..=[`FIELD_SIZE`] compared runners.
    ContestedRunnerCount(usize),
}

impl std::fmt::Display for SimError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SimError::InvalidSamples => write!(f, "nsamples must be a positive integer"),
            SimError::WrongRunnerCount(n) => {
                write!(
                    f,
                    "run_race_sim expects exactly {FIELD_SIZE} runners, got {n}"
                )
            }
            SimError::ContestedRunnerCount(n) => write!(
                f,
                "run_contested_compare expects 2..={FIELD_SIZE} compared runners, got {n}"
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
    if params.runners.len() != FIELD_SIZE {
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
    })
}

/// Run a same-race compare over `nsamples` contested rounds.
///
/// Compared runners are added first and are the only runners captured by the
/// compare collector. When `fill_mobs` is true, generated mob runners fill the
/// rest of the field to [`FIELD_SIZE`] so field-dependent mechanics can emerge
/// around the compared runners without increasing compare payload size.
pub fn run_contested_compare(params: ContestedCompareParams) -> Result<CompareData, SimError> {
    if params.nsamples == 0 {
        return Err(SimError::InvalidSamples);
    }
    if !(2..=FIELD_SIZE).contains(&params.runners.len()) {
        return Err(SimError::ContestedRunnerCount(params.runners.len()));
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

    if params.fill_mobs {
        let open_slots = FIELD_SIZE - focus_runner_ids.len();
        for mob in generate_mob_field().into_iter().take(open_slots) {
            race.add_runner(mob);
        }
    }

    let collector = CompareDataCollector::for_runner_ids(focus_runner_ids);
    race.subscribe(collector.handle());

    for i in 0..params.nsamples {
        race.prepare_round(params.master_seed + i as u64);
        race.run();
    }

    Ok(collector.result())
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
        }
    }

    fn contested_params(
        nsamples: usize,
        runners: Vec<CreateRunner>,
        fill_mobs: bool,
    ) -> ContestedCompareParams {
        ContestedCompareParams {
            course: test_course(),
            ground: GroundCondition::Firm,
            parameters: test_race_params(),
            settings: SimulationSettings::default(),
            runners,
            fill_mobs,
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
    fn rejects_wrong_runner_count() {
        let mut p = params(1);
        p.runners.pop();
        assert!(matches!(
            run_race_sim(p),
            Err(SimError::WrongRunnerCount(8))
        ));
    }

    #[test]
    fn runs_and_collects_shape() {
        let result = run_race_sim(params(3)).expect("sim runs");
        assert_eq!(result.finish_orders.len(), 3);
        for order in &result.finish_orders {
            assert_eq!(order.len(), FIELD_SIZE);
            assert!(order[0].finish_time > 0.0);
        }
        // Focus runner 0 traced over each round.
        assert_eq!(result.collected.rounds.len(), 3);
        assert_eq!(result.collected.rounds[0].focus.len(), 1);
        assert!(!result.collected.rounds[0].focus[0].samples.is_empty());
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
                false,
            )),
            Err(SimError::ContestedRunnerCount(1))
        ));
    }

    #[test]
    fn contested_compare_runs_two_runner_field() {
        let data = run_contested_compare(contested_params(
            2,
            vec![
                runner_props("a", Strategy::FrontRunner),
                runner_props("b", Strategy::FrontRunner),
            ],
            false,
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
            true,
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
            false,
        );
        // Narrow test course keeps same-strategy front-runners lane-close enough
        // for the live group coordinator to activate naturally.
        params.course.horse_lane = 0.01;
        let data = run_contested_compare(params).expect("contested compare runs");

        assert!(data.rounds[0]
            .runners
            .iter()
            .any(|runner| runner.spot_struggle_region.is_some()));
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

        let data = run_contested_compare(contested_params(1, vec![runaway, front], false))
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
