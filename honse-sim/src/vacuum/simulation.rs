//! The `run_compare` use case + its params value object.
//!
//! Port of the vacuum/compare orchestration: races a small synthetic field
//! (typically one runner) over `nsamples` rounds, attaching the
//! [`CompareDataCollector`], and returns the accumulated paired-delta read-model.

use crate::vacuum::collectors::{
    BasinData, BasinDataCollector, CompareData, CompareDataCollector, PositionData,
    PositionDataCollector,
};
use crate::vacuum::race::{Race, SimulationSettings};
use uma_sim_primitives::compare::PairedCompareData;
use uma_sim_primitives::compare_summary::{
    summarize_compare, CompareSummary, CompareSummaryData, SummaryError,
};
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
    /// A collected round was missing its focused runner.
    MissingCollectedRunner,
    /// The two sides of a paired compare were asked for different sample counts.
    UnpairedSamples {
        /// The first side's `nsamples`.
        first: usize,
        /// The second side's `nsamples`.
        second: usize,
    },
    /// A round could not be folded into the summary.
    Summary(SummaryError),
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
            SimError::MissingCollectedRunner => write!(f, "missing collected runner data"),
            SimError::UnpairedSamples { first, second } => write!(
                f,
                "a paired compare needs one sample count, got {first} and {second}"
            ),
            SimError::Summary(error) => write!(f, "{error}"),
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
    run_compare_indices(params, None)
}

/// Run a compare simulation for a named list of round indices.
///
/// Round `i` uses seed `master_seed + i` and pins its own round counter, so the
/// result is the same race the full batch ran at that index. This is how a
/// consumer re-runs the handful of rounds a summary named without replaying the
/// ones before them.
pub fn run_compare_rounds(
    params: CompareSimParams,
    indices: &[usize],
) -> Result<CompareData, SimError> {
    run_compare_indices(params, Some(indices))
}

/// Race each contestant in its own field and pair the rounds by index.
///
/// The classic vacuum compare diffs two separate races rather than one field,
/// so a paired-delta reader needs both sides' rounds. Both sides share one seed
/// schedule, and a caller that named indices gets those same indices on both.
pub fn run_paired_compare_rounds(
    first: CompareSimParams,
    second: CompareSimParams,
    indices: Option<&[usize]>,
) -> Result<PairedCompareData, SimError> {
    if first.nsamples != second.nsamples {
        return Err(SimError::UnpairedSamples {
            first: first.nsamples,
            second: second.nsamples,
        });
    }

    Ok(PairedCompareData {
        first: run_compare_indices(first, indices)?,
        second: run_compare_indices(second, indices)?,
    })
}

/// Fold a compare batch into the finished summary read-model.
///
/// The reduction lives in the engine rather than in a caller, so every consumer
/// of a comparison — the site, a CLI, a benchmark — reads the same bashin
/// deltas, stamina spreads, and activation profiles.
pub fn run_compare_summarized(params: CompareSimParams) -> Result<CompareSummaryData, SimError> {
    let data = run_compare(params)?;
    summarize_compare(&data).map_err(SimError::Summary)
}

/// Race each contestant in its own field, then reduce the paired rounds.
pub fn run_paired_compare_summarized(
    first: CompareSimParams,
    second: CompareSimParams,
) -> Result<CompareSummaryData, SimError> {
    let paired = run_paired_compare_rounds(first, second, None)?;
    let mut summary = CompareSummary::new();

    for (round_a, round_b) in paired.first.rounds.iter().zip(paired.second.rounds.iter()) {
        let runner_a = round_a
            .runners
            .first()
            .ok_or(SimError::MissingCollectedRunner)?;
        let runner_b = round_b
            .runners
            .first()
            .ok_or(SimError::MissingCollectedRunner)?;
        summary
            .observe(runner_a, runner_b)
            .map_err(SimError::Summary)?;
    }

    Ok(summary.finish())
}

/// Run the compare batch, or only `indices` when the caller named them.
fn run_compare_indices(
    params: CompareSimParams,
    indices: Option<&[usize]>,
) -> Result<CompareData, SimError> {
    validate_compare(&params)?;
    let (mut race, runner_ids, nsamples, master_seed) = prepare_race(params);

    let collector = CompareDataCollector::for_runner_ids(runner_ids);
    race.subscribe(collector.handle());

    for index in round_indices(nsamples, indices) {
        race.prepare_round_at(master_seed + index as u64, index);
        race.run();
    }

    Ok(collector.result())
}

/// The round indices to run: the named list, or `0..nsamples`.
fn round_indices(nsamples: usize, indices: Option<&[usize]>) -> Vec<usize> {
    match indices {
        Some(list) => list.to_vec(),
        None => (0..nsamples).collect(),
    }
}

/// Run a position-only compare simulation over `nsamples` rounds.
///
/// Same race setup and round seeds as [`run_compare`], but the attached
/// [`PositionDataCollector`] records only each focus runner's per-tick
/// position. The skill planner's bashin delta reads nothing else, so this keeps
/// the per-tick work and the serialized payload to the minimum it needs.
pub fn run_position_compare(params: CompareSimParams) -> Result<PositionData, SimError> {
    validate_compare(&params)?;
    let (mut race, runner_ids, nsamples, master_seed) = prepare_race(params);

    let collector = PositionDataCollector::for_runner_ids(runner_ids);
    race.subscribe(collector.handle());

    for i in 0..nsamples {
        race.prepare_round(master_seed + i as u64);
        race.run();
    }

    Ok(collector.result())
}

/// Run a basin compare simulation over `nsamples` rounds.
///
/// Same race setup and round seeds as [`run_compare`], but the attached
/// [`BasinDataCollector`] records only the channels the skill/unique basin
/// reduction reads (time, position, velocity, self-cast activation logs, used
/// skills, finish position). The mechanic regions and HP/lane/pacer/order
/// channels the full compare read-model carries are left out.
pub fn run_basin_compare(params: CompareSimParams) -> Result<BasinData, SimError> {
    run_basin_compare_indices(params, None)
}

/// Run a basin compare for a named list of round indices.
///
/// Round `i` uses seed `master_seed + i` and pins its own round counter, so the
/// result is the same race the batch ran at that index — which is how a skill
/// comparison materialises the handful of races its summary names.
pub fn run_basin_compare_indices(
    params: CompareSimParams,
    indices: Option<&[usize]>,
) -> Result<BasinData, SimError> {
    validate_compare(&params)?;
    let (mut race, runner_ids, nsamples, master_seed) = prepare_race(params);

    let collector = BasinDataCollector::for_runner_ids(runner_ids);
    race.subscribe(collector.handle());

    for index in round_indices(nsamples, indices) {
        race.prepare_round_at(master_seed + index as u64, index);
        race.run();
    }

    Ok(collector.result())
}

/// Reject params that cannot produce a compare run.
fn validate_compare(params: &CompareSimParams) -> Result<(), SimError> {
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
    Ok(())
}

/// Build the race, add every contestant, and truncate to the focus runners.
fn prepare_race(params: CompareSimParams) -> (Race, Vec<RunnerId>, usize, u64) {
    let nsamples = params.nsamples;
    let master_seed = params.master_seed;
    let focus_count = params.focus_count;

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
    runner_ids.truncate(focus_count);

    (race, runner_ids, nsamples, master_seed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use uma_sim_primitives::course::model::Straight;
    use uma_sim_primitives::mob::generate_mob_field;
    use uma_sim_primitives::projection::SkillEffectLog;
    use uma_sim_primitives::runner::test_support::{test_course, test_race_params};
    use uma_sim_primitives::shared_kernel::language::Strategy;

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
    fn vacuum_compare_can_surface_natural_spot_struggle() {
        // Classic's shape: the compared pair plus a third runner of the same style
        // in one synthetic race. The shared rule needs only a bunched pair, so the
        // mechanic is reachable without the contested engine's live field — which
        // is the whole point of routing both engines through one domain service.
        let mut params = compare_params(1, 3);
        params.focus_count = 2;
        // Narrow test course keeps same-style runners inside the lateral entry
        // gap (the same arrangement the contested equivalent uses).
        params.course.horse_lane = 0.01;
        for runner in &mut params.runners {
            runner.strategy = Strategy::FrontRunner;
        }

        let data = run_compare(params).expect("compare runs");

        assert!(
            data.rounds[0]
                .runners
                .iter()
                .any(|runner| runner.spot_struggle_region.is_some()),
            "expected a natural spot struggle in a three front-runner vacuum race"
        );
    }

    /// Focus runners with a dueling region, summed over a whole compare run.
    ///
    /// `test_course` ships no straights, and the artificial roll only happens on
    /// the final straight, so the course needs one before this can observe
    /// anything.
    fn dueling_count(with_dueling: bool) -> usize {
        let mut params = compare_params(500, 3);
        params.course.straights = vec![Straight {
            start: 2000.0,
            end: 2400.0,
            front_type: 0,
        }];
        params.settings.dueling = with_dueling;
        params.focus_count = 2;

        let data = run_compare(params).expect("compare runs");
        data.rounds
            .iter()
            .flat_map(|round| &round.runners)
            .filter(|runner| runner.dueling_region.is_some())
            .count()
    }

    #[test]
    fn artificial_dueling_needs_the_setting_as_well_as_the_rates() {
        // The vacuum dueling model is a per-runner artificial roll, so the rates
        // passed alongside it are inert while `dueling` is off: the step returns
        // at the `dueling_enabled` guard before it ever rolls, and a compare run
        // reports no duels at all without saying so.
        assert!(
            dueling_count(true) > 0,
            "expected artificial dueling to fire with the setting on"
        );
        assert_eq!(dueling_count(false), 0);
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
    fn position_compare_matches_full_compare_positions() {
        // The planner's lean read model must record the exact same position
        // frames as the full compare collector; only the other channels differ.
        let full = run_compare(compare_params(3, 1)).expect("full");
        let lean = run_position_compare(compare_params(3, 1)).expect("lean");

        assert_eq!(lean.rounds.len(), full.rounds.len());
        for (lean_round, full_round) in lean.rounds.iter().zip(&full.rounds) {
            assert_eq!(lean_round.seed, full_round.seed);
            assert_eq!(lean_round.primary_runner_id, full_round.primary_runner_id);
            let lean_positions: Vec<&Vec<f64>> =
                lean_round.runners.iter().map(|r| &r.position).collect();
            let full_positions: Vec<&Vec<f64>> =
                full_round.runners.iter().map(|r| &r.position).collect();
            assert_eq!(lean_positions, full_positions);
        }
    }

    /// Drop `execution_id` so the basin and full collectors compare on semantics:
    /// the basin skips the targeted reconcile, so its sequence counter (and thus
    /// the ids) can advance differently without changing any log's meaning.
    fn without_execution_ids(
        map: &HashMap<String, Vec<SkillEffectLog>>,
    ) -> HashMap<String, Vec<SkillEffectLog>> {
        map.iter()
            .map(|(skill_id, logs)| {
                let stripped = logs
                    .iter()
                    .map(|log| {
                        let mut clone = log.clone();
                        clone.execution_id = String::new();
                        clone
                    })
                    .collect();
                (skill_id.clone(), stripped)
            })
            .collect()
    }

    #[test]
    fn basin_compare_matches_full_compare_channels() {
        // The basin keeps time/position/velocity, self-cast logs, used skills,
        // and finish position — and nothing else. Every kept channel must match
        // the full collector exactly.
        let full = run_compare(compare_params(3, 1)).expect("full");
        let basin = run_basin_compare(compare_params(3, 1)).expect("basin");

        assert_eq!(basin.rounds.len(), full.rounds.len());
        for (basin_round, full_round) in basin.rounds.iter().zip(&full.rounds) {
            assert_eq!(basin_round.seed, full_round.seed);
            assert_eq!(basin_round.primary_runner_id, full_round.primary_runner_id);

            for (basin_runner, full_runner) in basin_round.runners.iter().zip(&full_round.runners) {
                assert_eq!(basin_runner.runner_id, full_runner.runner_id);
                assert_eq!(basin_runner.time, full_runner.time);
                assert_eq!(basin_runner.position, full_runner.position);
                assert_eq!(basin_runner.velocity, full_runner.velocity);
                assert_eq!(basin_runner.used_skills, full_runner.used_skills);
                assert_eq!(basin_runner.finish_position, full_runner.finish_position);
                assert_eq!(
                    without_execution_ids(&basin_runner.skill_activations),
                    without_execution_ids(&full_runner.skill_activations)
                );
            }
        }
    }

    #[test]
    fn named_rounds_reproduce_the_batch_rounds() {
        // A summary names the sample each statistic came from, and the caller
        // re-runs exactly those. Round `i` is seeded `master_seed + i`, so the
        // named run must be the batch's own round, not merely a race of that
        // seed.
        let batch = run_compare(compare_params(5, 1)).expect("batch");
        let picked = run_compare_rounds(compare_params(5, 1), &[1, 3]).expect("named rounds");

        assert_eq!(picked.rounds.len(), 2);
        assert_eq!(picked.rounds[0], batch.rounds[1]);
        assert_eq!(picked.rounds[1], batch.rounds[3]);
    }

    #[test]
    fn merged_chunk_summaries_equal_one_batch_summary() {
        // The compare worker splits a batch into progressive chunks. Reducing
        // each chunk and merging must land on the same read-model as reducing
        // the whole batch once, or a chunked run and a single run disagree.
        let mut full_params = compare_params(6, 2);
        full_params.focus_count = 2;
        let full = run_compare_summarized(full_params).expect("full summary");

        let mut first_params = compare_params(3, 2);
        first_params.focus_count = 2;
        let mut accumulated = CompareSummary::new();
        accumulated
            .observe_batch(&run_compare(first_params).expect("first chunk"), 0, 1)
            .expect("observe first chunk");

        let mut second_params = compare_params(3, 2);
        second_params.focus_count = 2;
        second_params.master_seed += 3;
        let mut second = CompareSummary::new();
        second
            .observe_batch(&run_compare(second_params).expect("second chunk"), 0, 1)
            .expect("observe second chunk");

        accumulated.merge(second);
        assert_eq!(accumulated.finish(), full);
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
