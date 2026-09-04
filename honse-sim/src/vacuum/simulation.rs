//! The `run_compare` use case + its params value object.
//!
//! Port of the vacuum/compare orchestration: races a small synthetic field
//! (typically one runner) over `nsamples` rounds, attaching the
//! [`CompareDataCollector`], and returns the accumulated paired-delta read-model.

use crate::vacuum::collectors::{CompareData, CompareDataCollector};
use crate::vacuum::race::{Race, SimulationSettings};
use uma_sim_primitives::course::model::CourseData;
use uma_sim_primitives::runner::lifecycle::CreateRunner;
use uma_sim_primitives::runner::mechanics::DuelingRates;
use uma_sim_primitives::shared_kernel::ids::RunnerId;
use uma_sim_primitives::shared_kernel::language::GroundCondition;
use uma_sim_primitives::shared_kernel::params::RaceParameters;

/// Errors raised validating / running a compare simulation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SimError {
    /// `nsamples` must be a positive integer.
    InvalidSamples,
    /// The field must not be empty.
    WrongRunnerCount(usize),
    /// `focus_count` must be within `1..=runners.len()`.
    InvalidFocusCount {
        /// The rejected `focus_count`.
        focus_count: usize,
        /// The number of runners in the field.
        runners: usize,
    },
}

impl std::fmt::Display for SimError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SimError::InvalidSamples => write!(f, "nsamples must be a positive integer"),
            SimError::WrongRunnerCount(n) => {
                write!(f, "run_compare expects a non-empty field, got {n}")
            }
            SimError::InvalidFocusCount {
                focus_count,
                runners,
            } => write!(
                f,
                "focus_count must be within 1..={runners} (the field size), got {focus_count}"
            ),
        }
    }
}

impl std::error::Error for SimError {}

/// Inputs to [`run_compare`].
///
/// The compare family races a small vacuum field (typically a single runner)
/// over `nsamples` rounds and projects the rich per-runner [`CompareData`]
/// read-model. Unlike [`crate::contested::run_race_sim`] there is no field-size
/// requirement. The classic vacuum compare runs each contestant in its own race
/// (`focus_count = 1`) and diffs the collected telemetry on the TS side; a
/// same-race vacuum compare puts both contestants in one field
/// (`focus_count = 2`) so they pace off each other while skills still resolve
/// against the approximate field.
pub struct CompareSimParams {
    /// The course to race.
    pub course: CourseData,
    /// Ground condition.
    pub ground: GroundCondition,
    /// Race-wide parameters.
    pub parameters: RaceParameters,
    /// Simulation settings (compare mode, toggles, sample budget).
    pub settings: SimulationSettings,
    /// Per-strategy dueling rates (compare-mode artificial dueling).
    pub dueling_rates: DuelingRates,
    /// The field: the compared contestants first, then any context runners
    /// (e.g. a dedicated pacer). Only the first `focus_count` runners are
    /// collected.
    pub runners: Vec<CreateRunner>,
    /// How many leading runners to collect (`1..=runners.len()`).
    pub focus_count: usize,
    /// Number of rounds to simulate.
    pub nsamples: usize,
    /// Master seed (round `i` uses `master_seed + i`).
    pub master_seed: u64,
}

/// Run a compare simulation over `nsamples` rounds.
///
/// Constructs the [`Race`] aggregate with the given dueling rates, adds the
/// contestants (compared runners first, then context runners), attaches the
/// [`CompareDataCollector`] focused on the first `focus_count` runners, and
/// runs `nsamples` rounds with seeds `master_seed + i`. Returns the accumulated
/// [`CompareData`] projection (per-round focus telemetry); the bashin-delta +
/// summary statistics are computed by the caller (TS side).
pub fn run_compare(params: CompareSimParams) -> Result<CompareData, SimError> {
    if params.nsamples == 0 {
        return Err(SimError::InvalidSamples);
    }
    if params.runners.is_empty() {
        return Err(SimError::WrongRunnerCount(0));
    }
    if !(1..=params.runners.len()).contains(&params.focus_count) {
        return Err(SimError::InvalidFocusCount {
            focus_count: params.focus_count,
            runners: params.runners.len(),
        });
    }

    let mut race = Race::new(
        params.course,
        params.ground,
        params.settings,
        params.parameters,
        Some(params.dueling_rates),
    );
    let mut runner_ids: Vec<RunnerId> = Vec::with_capacity(params.runners.len());
    for runner in params.runners {
        runner_ids.push(race.add_runner(runner));
    }

    // Collect only the compared runners: context runners (e.g. a dedicated
    // pacer) shape the race but their per-frame telemetry is never read on the
    // TS side, so collecting it would only multiply the WASM payload.
    runner_ids.truncate(params.focus_count);
    let collector = CompareDataCollector::for_runner_ids(runner_ids);
    race.subscribe(collector.handle());

    for i in 0..params.nsamples {
        race.prepare_round(params.master_seed + i as u64);
        race.run();
    }

    Ok(collector.result())
}

#[cfg(test)]
mod tests {
    use super::*;
    use uma_sim_primitives::mob::generate_mob_field;
    use uma_sim_primitives::runner::test_support::{test_course, test_race_params};

    fn compare_params(nsamples: usize, runners: usize) -> CompareSimParams {
        CompareSimParams {
            course: test_course(),
            ground: GroundCondition::Firm,
            parameters: test_race_params(),
            settings: SimulationSettings::default(),
            dueling_rates: DuelingRates {
                runaway: 10.0,
                front_runner: 10.0,
                pace_chaser: 10.0,
                late_surger: 10.0,
                end_closer: 10.0,
            },
            runners: generate_mob_field().into_iter().take(runners).collect(),
            focus_count: 1,
            nsamples,
            master_seed: 4242,
        }
    }

    #[test]
    fn compare_rejects_out_of_range_focus_count() {
        for focus_count in [0, 3] {
            let mut params = compare_params(1, 2);
            params.focus_count = focus_count;
            assert!(matches!(
                run_compare(params),
                Err(SimError::InvalidFocusCount { focus_count: f, runners: 2 }) if f == focus_count
            ));
        }
    }

    #[test]
    fn compare_with_focus_count_collects_leading_runners_only() {
        let mut params = compare_params(3, 3);
        params.focus_count = 2;
        let data = run_compare(params).expect("compare runs");
        assert_eq!(data.rounds.len(), 3);
        for round in &data.rounds {
            let ids: Vec<u32> = round.runners.iter().map(|r| r.runner_id).collect();
            assert_eq!(ids, vec![0, 1]);
            assert!(round.runners.iter().all(|r| r.finished));
        }
    }

    #[test]
    fn compare_rejects_invalid_sample_count() {
        assert!(matches!(
            run_compare(compare_params(0, 1)),
            Err(SimError::InvalidSamples)
        ));
    }

    #[test]
    fn compare_rejects_empty_field() {
        assert!(matches!(
            run_compare(compare_params(1, 0)),
            Err(SimError::WrongRunnerCount(0))
        ));
    }

    #[test]
    fn compare_runs_single_runner_vacuum() {
        let data = run_compare(compare_params(3, 1)).expect("compare runs");
        assert_eq!(data.rounds.len(), 3);
        for round in &data.rounds {
            assert_eq!(round.runners.len(), 1);
            assert_eq!(round.primary_runner_id, Some(round.runners[0].runner_id));
            assert!(round.runners[0].finished);
            assert!(!round.runners[0].position.is_empty());
        }
    }

    #[test]
    fn compare_with_context_runners_collects_primary_only() {
        let data = run_compare(compare_params(3, 3)).expect("compare runs");
        assert_eq!(data.rounds.len(), 3);
        for round in &data.rounds {
            assert_eq!(round.primary_runner_id, Some(0));
            assert_eq!(round.runners.len(), 1);
            assert_eq!(round.runners[0].runner_id, 0);
            assert!(round.runners[0].finished);
            assert!(!round.runners[0].position.is_empty());
        }
    }

    #[test]
    fn compare_deterministic_for_same_seed() {
        let a = run_compare(compare_params(2, 1)).expect("a");
        let b = run_compare(compare_params(2, 1)).expect("b");
        assert_eq!(a, b);
    }

    #[test]
    fn compare_round_chunks_are_bit_identical_to_single_batch() {
        // Round independence (ADR-0004): round `i` depends only on its seed
        // (`master_seed + i`), never on prior rounds in the same instance. The
        // progressive compare worker relies on this — it runs rounds in
        // seed-offset chunks and concatenates them, which MUST equal one full
        // batch exactly. (This is what the per-round `on_prepare` reset buys us.)
        let full = run_compare(compare_params(6, 1)).expect("full batch");

        // Chunk 1: rounds [0, 3) at master_seed (4242).
        let chunk1 = run_compare(compare_params(3, 1)).expect("chunk1");
        // Chunk 2: rounds [3, 6) at master_seed + 3.
        let mut p2 = compare_params(3, 1);
        p2.master_seed += 3;
        let chunk2 = run_compare(p2).expect("chunk2");

        let mut stitched = chunk1.rounds;
        stitched.extend(chunk2.rounds);

        assert_eq!(full.rounds.len(), 6);
        assert_eq!(stitched.len(), 6);
        assert_eq!(
            full.rounds, stitched,
            "seed-offset round chunks must be bit-identical to a single full batch"
        );
    }
}
