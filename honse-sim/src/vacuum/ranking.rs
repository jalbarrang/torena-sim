//! Dedicated skill-ranking use case.
//!
//! Ranks candidate skills by their marginal bashin contribution on top of a
//! fixed baseline runner. Unlike `run_compare`, the bashin delta is computed
//! here rather than on the TS side, so only the per-candidate summary crosses
//! the WASM boundary — no per-sample position series. The baseline is simulated
//! once and reused across every candidate.

use crate::vacuum::collectors::{PositionData, PositionDataCollector};
use crate::vacuum::race::{Race, SimulationSettings};
use crate::vacuum::simulation::SimError;
use uma_sim_primitives::course::model::CourseData;
use uma_sim_primitives::runner::lifecycle::CreateRunner;
use uma_sim_primitives::runner::mechanics::DuelingRates;
use uma_sim_primitives::shared_kernel::ids::RunnerId;
use uma_sim_primitives::shared_kernel::language::GroundCondition;
use uma_sim_primitives::shared_kernel::params::RaceParameters;
use uma_sim_primitives::skills::model::Skill;

/// Metres per horse length. The game scores one bashin as 2.5 m.
const METERS_PER_BASHIN: f64 = 2.5;

/// Inputs to [`rank_skills`].
pub struct SkillRankParams {
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
    /// The baseline runner (its own skills included).
    pub runner: CreateRunner,
    /// Skills to measure, one candidate per entry.
    pub candidates: Vec<RankCandidate>,
    /// Number of rounds to simulate per runner.
    pub nsamples: usize,
    /// Master seed (round `i` uses `master_seed + i`).
    pub master_seed: u64,
    /// Stretch of the race the delta is measured over, in metres.
    pub window_start: f64,
    /// End of the measured stretch, in metres.
    pub window_end: f64,
}

/// One candidate to measure: the skill to add, and the baseline skills it
/// replaces.
///
/// The game never fires two tiers of one skill: a runner that owns Corner Adept
/// ○ and is measured with Professor of Curvature races with the gold instead of
/// the white. Families live in the dataset, not in this crate, so the caller
/// names the baseline skills the candidate supersedes.
#[derive(Debug, Clone, PartialEq)]
pub struct RankCandidate {
    /// The skill appended to the baseline for this candidate's race.
    pub skill: Skill,
    /// Baseline skill ids this candidate replaces (its family's lower tiers).
    pub supersedes: Vec<String>,
}

/// One candidate's measured marginal over the baseline.
#[derive(Debug, Clone, PartialEq)]
pub struct SkillRankEntry {
    /// The candidate skill id.
    pub skill_id: String,
    /// Mean bashin gained over the baseline.
    pub mean: f64,
    /// Minimum per-sample bashin.
    pub min: f64,
    /// Maximum per-sample bashin.
    pub max: f64,
    /// Median per-sample bashin.
    pub median: f64,
    /// Per-sample bashin deltas, ascending.
    pub results: Vec<f64>,
}

/// Ranking output: one entry per candidate, in input order.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SkillRankData {
    /// Per-candidate results.
    pub entries: Vec<SkillRankEntry>,
}

/// Rank each candidate against a shared baseline.
pub fn rank_skills(params: &SkillRankParams) -> Result<SkillRankData, SimError> {
    if params.nsamples == 0 {
        return Err(SimError::InvalidSamples);
    }
    if params.candidates.is_empty() {
        return Ok(SkillRankData::default());
    }

    let baseline = run_positions(params, params.runner.clone());

    let mut entries = Vec::with_capacity(params.candidates.len());
    for candidate in &params.candidates {
        let mut runner = params.runner.clone();
        // The candidate replaces the tiers it supersedes rather than stacking on
        // top of them, so the measured delta is the upgrade's marginal value.
        runner.skills.retain(|skill| {
            !candidate
                .supersedes
                .iter()
                .any(|id| id == skill.skill_id.as_str())
        });
        runner.skills.push(candidate.skill.clone());
        let candidate_positions = run_positions(params, runner);
        entries.push(summarize(
            candidate.skill.skill_id.0.clone(),
            &baseline,
            &candidate_positions,
            params.nsamples,
            params.window_start,
            params.window_end,
        )?);
    }

    Ok(SkillRankData { entries })
}

/// Run one runner for `nsamples` rounds and collect only its positions.
fn run_positions(params: &SkillRankParams, runner: CreateRunner) -> PositionData {
    let mut settings = params.settings.clone();
    // A ranking measures a marginal, so isolate each skill's placement stream:
    // adding the candidate must not reshuffle the baseline's skills.
    settings.isolate_skill_rng = true;
    let mut race = Race::new(
        params.course.clone(),
        params.ground,
        settings,
        params.parameters.clone(),
        Some(params.dueling_rates),
    );
    let id: RunnerId = race.add_runner(runner);
    let collector = PositionDataCollector::for_runner_ids([id]);
    race.subscribe(collector.handle());

    for i in 0..params.nsamples {
        race.prepare_round(params.master_seed + i as u64);
        race.run();
    }

    collector.result()
}

/// Per-sample bashin of `candidate` over `baseline` inside the window, then its summary.
fn summarize(
    skill_id: String,
    baseline: &PositionData,
    candidate: &PositionData,
    nsamples: usize,
    window_start: f64,
    window_end: f64,
) -> Result<SkillRankEntry, SimError> {
    let mut results = Vec::with_capacity(nsamples);

    for i in 0..nsamples {
        let baseline_position = round_positions(baseline, i)?;
        let candidate_position = round_positions(candidate, i)?;
        results.push(window_delta(
            baseline_position,
            candidate_position,
            window_start,
            window_end,
        ));
    }

    results.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let mid = results.len() / 2;
    let median = if results.len() % 2 == 0 {
        (results[mid - 1] + results[mid]) / 2.0
    } else {
        results[mid]
    };
    let mean = results.iter().sum::<f64>() / results.len() as f64;

    Ok(SkillRankEntry {
        skill_id,
        mean,
        min: results[0],
        max: results[results.len() - 1],
        median,
        results,
    })
}

/// Bashin `candidate` gained over `baseline` inside `[window_start, window_end]`.
///
/// Mirrors the TS `bashinDeltaOverWindow`: boundaries are marked on the baseline's
/// timeline, and subtracting the gap at the window's first frame leaves only the
/// ground taken within it. A full-race window (0..=end) reduces to the finish gap.
fn window_delta(baseline: &[f64], candidate: &[f64], window_start: f64, window_end: f64) -> f64 {
    let last_frame = baseline.len().min(candidate.len());
    if last_frame == 0 {
        return 0.0;
    }
    let last_frame = last_frame - 1;

    let start_frame = frame_reaching(baseline, window_start, last_frame);
    let end_frame = frame_reaching(baseline, window_end, last_frame);
    let gap_at_start = candidate[start_frame] - baseline[start_frame];
    let gap_at_end = candidate[end_frame] - baseline[end_frame];

    (gap_at_end - gap_at_start) / METERS_PER_BASHIN
}

/// First frame at or past `distance`, clamped to `last_frame`.
fn frame_reaching(position: &[f64], distance: f64, last_frame: usize) -> usize {
    position
        .iter()
        .take(last_frame + 1)
        .position(|&value| value >= distance)
        .unwrap_or(last_frame)
}

/// The focused runner's position series for one round.
fn round_positions(data: &PositionData, round: usize) -> Result<&[f64], SimError> {
    data.rounds
        .get(round)
        .and_then(|round| round.runners.first())
        .map(|runner| runner.position.as_slice())
        .ok_or(SimError::MissingCollectedRunner)
}
