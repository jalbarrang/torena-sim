//! Reductions over the lean compare read models.
//!
//! Two comparison paths ask narrower questions than a full compare and get their
//! own read model for it: the skill/unique basin reads positions plus the
//! tracked skill's activations, and the skill planner reads positions only. This
//! module owns the arithmetic both need — the bashin delta (whole race, or a
//! window of it) and the summary that carries it — so the engine's own ranking,
//! the app's panels, and any other consumer measure the same gap the same way.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::compare::{BasinRound, BasinRoundData, PositionRound, PositionRoundData};
use crate::compare_summary::{
    as_transported, meters_to_bashin, RepresentativeIndices, SampleDistribution, SummaryError,
};
use crate::projection::{EffectPerspective, SkillEffectLog};
use crate::shared_kernel::ids::SkillId;

/// The stretch of the race a skill comparison scores.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct EvaluationWindow {
    /// Start of the measured stretch, in metres.
    pub start_distance: f64,
    /// End of the measured stretch, in metres.
    pub end_distance: f64,
}

/// The effect a synthetic activation log carries when the round recorded none.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FallbackEffect {
    /// Effect type discriminant, from the tracked skill's data.
    pub effect_type: i32,
    /// Effect target discriminant, from the tracked skill's data.
    pub effect_target: i32,
}

/// A batch of bashin deltas, summarised.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct BashinSummary {
    /// One delta per sample, ascending.
    pub results: Vec<f64>,
    /// Smallest delta.
    pub min: f64,
    /// Largest delta.
    pub max: f64,
    /// Mean delta.
    pub mean: f64,
    /// Median delta.
    pub median: f64,
}

/// What the tracked skill did in one sample.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillTrackedMeta {
    /// Bashin the tracked skill gained over the baseline, measured at the finish.
    pub horse_length: f64,
    /// Distances the skill activated at, in activation order.
    pub positions: Vec<f64>,
}

/// One tracked-skill comparison, reduced.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillCompareSummaryData {
    /// One delta per sample, ascending.
    pub results: Vec<f64>,
    /// Smallest delta.
    pub min: f64,
    /// Largest delta.
    pub max: f64,
    /// Mean delta.
    pub mean: f64,
    /// Median delta.
    pub median: f64,
    /// Which sample each representative race comes from.
    pub representative: Option<RepresentativeIndices>,
    /// Per-sample activation metadata, in sample order, for the samples that had any.
    pub tracked_meta: Vec<SkillTrackedMeta>,
}

/// One runner's per-tick series, as a chart reads it.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct SkillRunSeries {
    /// Per-tick elapsed time.
    pub time: Vec<f64>,
    /// Per-tick position.
    pub position: Vec<f64>,
    /// Per-tick true velocity.
    pub velocity: Vec<f64>,
}

/// One activation in a chart payload, in the shape the boundary transports.
///
/// The domain log carries a perspective enum; a consumer reads the game's own
/// numeric codes (1 self, 2 other), so the payload states them that way.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillRunLog {
    /// Unique id for this activation within the round.
    pub execution_id: String,
    /// Skill id that produced the effect.
    pub skill_id: String,
    /// Position where the effect began.
    pub start: f64,
    /// Position where the effect ended.
    pub end: f64,
    /// Perspective (1 = self, 2 = other).
    pub perspective: i32,
    /// Effect type discriminant.
    pub effect_type: i32,
    /// Effect target discriminant.
    pub effect_target: i32,
}

impl From<&SkillEffectLog> for SkillRunLog {
    fn from(log: &SkillEffectLog) -> Self {
        SkillRunLog {
            execution_id: log.execution_id.clone(),
            skill_id: log.skill_id.clone(),
            start: log.start,
            end: log.end,
            perspective: match log.perspective {
                EffectPerspective::SelfCast => 1,
                EffectPerspective::Other => 2,
            },
            effect_type: log.effect_type,
            effect_target: log.effect_target,
        }
    }
}

/// One representative race of a tracked-skill comparison.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct SkillRunPayload {
    /// The tracked skill's activation logs for this sample.
    pub logs: Vec<SkillRunLog>,
    /// The baseline runner's series.
    pub baseline: SkillRunSeries,
    /// The tracked runner's series.
    pub tracked: SkillRunSeries,
}

/// Summarise a batch of deltas.
pub fn summarize_bashin(deltas: &[f64]) -> BashinSummary {
    let Some(distribution) = SampleDistribution::from_values(deltas.to_vec()) else {
        return BashinSummary::default();
    };

    BashinSummary {
        results: distribution.values,
        min: distribution.min,
        max: distribution.max,
        mean: distribution.mean,
        median: distribution.median,
    }
}

/// The last frame both series share, or `None` when either is empty.
fn last_common_frame(baseline: &[f64], candidate: &[f64]) -> Option<usize> {
    let frames = baseline.len().min(candidate.len());
    if frames == 0 {
        None
    } else {
        Some(frames - 1)
    }
}

/// First frame at or past `distance`, clamped to `last_frame`.
///
/// A series that never gets there (it ends short, or the window starts beyond
/// the race) clamps, which makes such a window measure nothing rather than
/// throw.
fn frame_reaching(position: &[f64], distance: f64, last_frame: usize) -> usize {
    for frame in 0..=last_frame {
        if position.get(frame).copied().unwrap_or_default() >= distance {
            return frame;
        }
    }

    last_frame
}

/// Bashin gained by `candidate` over `baseline` at the finish.
///
/// Measured on the transported values, like every summary here: the read model
/// narrows these series to `f32`, so this agrees to the bit with a consumer that
/// diffs the series it received.
pub fn bashin_delta(baseline: &[f64], candidate: &[f64]) -> Option<f64> {
    let last = last_common_frame(baseline, candidate)?;
    let gap = as_transported(candidate[last]) - as_transported(baseline[last]);
    Some(meters_to_bashin(gap))
}

/// Bashin `candidate` gained over `baseline` *inside* `window`.
///
/// Boundaries are marked on the baseline's timeline because the baseline is the
/// control. Frame index is shared time between the two series, so subtracting
/// the gap at the window's first frame leaves only the ground taken within it.
pub fn bashin_delta_over_window(
    baseline: &[f64],
    candidate: &[f64],
    window: EvaluationWindow,
) -> Option<f64> {
    let last_frame = last_common_frame(baseline, candidate)?;
    let start_frame = frame_reaching(baseline, window.start_distance, last_frame);
    let end_frame = frame_reaching(baseline, window.end_distance, last_frame);

    let gap_at_start =
        as_transported(*candidate.get(start_frame)?) - as_transported(*baseline.get(start_frame)?);
    let gap_at_end =
        as_transported(*candidate.get(end_frame)?) - as_transported(*baseline.get(end_frame)?);

    Some(meters_to_bashin(gap_at_end - gap_at_start))
}

/// The round's primary runner.
fn primary_of(round: &BasinRound) -> Option<&BasinRoundData> {
    match round.primary_runner_id {
        Some(id) => round.runners.iter().find(|runner| runner.runner_id == id),
        None => round.runners.first(),
    }
}

/// The position-only round's primary runner.
fn primary_position_of(round: &PositionRound) -> Option<&PositionRoundData> {
    match round.primary_runner_id {
        Some(id) => round.runners.iter().find(|runner| runner.runner_id == id),
        None => round.runners.first(),
    }
}

/// Whether two skill ids name the same skill, ignoring an activation variant
/// suffix (`200011-1` is `200011`).
fn same_skill(left: &str, right: &str) -> bool {
    SkillId::new(left).base() == SkillId::new(right).base()
}

/// The tracked skill's self-cast activation logs, normalized to its id.
///
/// Skill ids are visited in sorted order rather than map order: a HashMap's
/// iteration order must never reach an ordered output, and the positions list
/// this feeds is drawn in that order.
fn tracked_logs(round: &BasinRoundData, tracked_skill_id: &str) -> Vec<SkillEffectLog> {
    let mut by_skill: BTreeMap<&str, &Vec<SkillEffectLog>> = BTreeMap::new();
    for (skill_id, logs) in &round.skill_activations {
        if same_skill(skill_id, tracked_skill_id) {
            by_skill.insert(skill_id.as_str(), logs);
        }
    }

    let mut matching = Vec::new();
    for logs in by_skill.values() {
        for log in *logs {
            matching.push(SkillEffectLog {
                skill_id: tracked_skill_id.to_string(),
                ..log.clone()
            });
        }
    }

    matching
}

/// Whether the runner used the tracked skill this round.
fn used_tracked(round: &BasinRoundData, tracked_skill_id: &str) -> bool {
    round
        .used_skills
        .iter()
        .any(|skill_id| same_skill(skill_id, tracked_skill_id))
}

/// A single activation at the finish, for a tracked skill that fired but left no
/// log — the read model does not record why, and a comparison with no marker
/// would read as "never procced".
fn fallback_log(
    round: &BasinRoundData,
    seed: u64,
    tracked_skill_id: &str,
    fallback: FallbackEffect,
) -> Vec<SkillEffectLog> {
    let activation_position = match round.position.last().copied() {
        Some(last) => last.min(round.finish_position),
        None => round.finish_position,
    };

    vec![SkillEffectLog {
        execution_id: format!("{seed}-{}-fallback", round.runner_id),
        skill_id: tracked_skill_id.to_string(),
        start: activation_position,
        end: activation_position,
        perspective: EffectPerspective::SelfCast,
        effect_type: fallback.effect_type,
        effect_target: fallback.effect_target,
    }]
}

/// The tracked skill's logs for one round: recorded ones, or the fallback.
fn resolved_logs(
    round: &BasinRoundData,
    seed: u64,
    tracked_skill_id: &str,
    fallback: FallbackEffect,
) -> (Vec<SkillEffectLog>, bool) {
    let used = used_tracked(round, tracked_skill_id);
    let logs = tracked_logs(round, tracked_skill_id);

    if logs.is_empty() {
        (
            if used {
                fallback_log(round, seed, tracked_skill_id, fallback)
            } else {
                Vec::new()
            },
            used,
        )
    } else {
        (logs, used)
    }
}

/// The distinct distances the logs started at, in order.
fn unique_positions(logs: &[SkillEffectLog]) -> Vec<f64> {
    let mut positions: Vec<f64> = Vec::new();
    for log in logs {
        let previous = positions.last().copied();
        if previous.is_none_or(|value| (value - log.start).abs() > 1e-9) {
            positions.push(log.start);
        }
    }
    positions
}

/// A tracked-skill comparison, accumulated across the batch.
///
/// Fold samples with [`observe`](Self::observe), [`merge`](Self::merge) chunks,
/// then [`finish`](Self::finish): the representative races and the confidence
/// summary are only meaningful once the whole batch is in.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SkillCompareSummary {
    deltas: Vec<f64>,
    tracked_meta: Vec<SkillTrackedMeta>,
}

impl SkillCompareSummary {
    /// An empty comparison.
    pub fn new() -> Self {
        Self::default()
    }

    /// Fold one paired sample into the comparison.
    pub fn observe(
        &mut self,
        baseline: &BasinRound,
        tracked: &BasinRound,
        tracked_skill_id: &str,
        fallback: FallbackEffect,
        window: EvaluationWindow,
    ) -> Result<(), SummaryError> {
        let baseline_runner = primary_of(baseline).ok_or(SummaryError::MissingRunner(0))?;
        let tracked_runner = primary_of(tracked).ok_or(SummaryError::MissingRunner(0))?;

        let delta =
            bashin_delta_over_window(&baseline_runner.position, &tracked_runner.position, window)
                .ok_or(SummaryError::EmptyPositionSeries)?;

        let (logs, used) = resolved_logs(tracked_runner, tracked.seed, tracked_skill_id, fallback);
        let positions = unique_positions(&logs);

        self.deltas.push(delta);
        if used || !positions.is_empty() {
            self.tracked_meta.push(SkillTrackedMeta {
                horse_length: delta,
                positions,
            });
        }

        Ok(())
    }

    /// Fold another chunk's comparison in, keeping sample order.
    pub fn merge(&mut self, other: Self) {
        self.deltas.extend(other.deltas);
        self.tracked_meta.extend(other.tracked_meta);
    }

    /// How many samples the comparison holds.
    pub fn samples(&self) -> usize {
        self.deltas.len()
    }

    /// The finished comparison.
    pub fn finish(self) -> SkillCompareSummaryData {
        let representative = RepresentativeIndices::of(&self.deltas);
        let summary = summarize_bashin(&self.deltas);

        SkillCompareSummaryData {
            results: summary.results,
            min: summary.min,
            max: summary.max,
            mean: summary.mean,
            median: summary.median,
            representative,
            tracked_meta: self.tracked_meta,
        }
    }
}

/// A runner's series, as a chart reads it.
fn series_of(round: &BasinRoundData) -> SkillRunSeries {
    SkillRunSeries {
        time: round.time.clone(),
        position: round.position.clone(),
        velocity: round.velocity.clone(),
    }
}

/// Build one representative race's chart payload.
///
/// The logs come from the same resolution the reduction used, so the markers a
/// chart draws cannot disagree with the metadata it was selected by.
pub fn skill_run_payload(
    baseline: &BasinRound,
    tracked: &BasinRound,
    tracked_skill_id: &str,
    fallback: FallbackEffect,
) -> Result<SkillRunPayload, SummaryError> {
    let baseline_runner = primary_of(baseline).ok_or(SummaryError::MissingRunner(0))?;
    let tracked_runner = primary_of(tracked).ok_or(SummaryError::MissingRunner(0))?;
    let (logs, _) = resolved_logs(tracked_runner, tracked.seed, tracked_skill_id, fallback);

    Ok(SkillRunPayload {
        logs: logs.iter().map(SkillRunLog::from).collect(),
        baseline: series_of(baseline_runner),
        tracked: series_of(tracked_runner),
    })
}

/// The bashin deltas between two position-only batches, round-aligned.
///
/// The planner compares a candidate run against a baseline it reuses, so this
/// takes both batches rather than racing them itself.
pub fn bashin_between(
    baseline: &[PositionRound],
    candidate: &[PositionRound],
) -> Result<BashinSummary, SummaryError> {
    let mut deltas = Vec::with_capacity(baseline.len().min(candidate.len()));

    for (base_round, candidate_round) in baseline.iter().zip(candidate.iter()) {
        let base_runner = primary_position_of(base_round).ok_or(SummaryError::MissingRunner(0))?;
        let candidate_runner =
            primary_position_of(candidate_round).ok_or(SummaryError::MissingRunner(0))?;

        deltas.push(
            bashin_delta(&base_runner.position, &candidate_runner.position)
                .ok_or(SummaryError::EmptyPositionSeries)?,
        );
    }

    Ok(summarize_bashin(&deltas))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::disallowed_methods)]

    use super::*;

    fn basin_round(seed: u64, position: Vec<f64>, used: &[&str]) -> BasinRound {
        BasinRound {
            seed,
            primary_runner_id: Some(1),
            runners: vec![BasinRoundData {
                runner_id: 1,
                position,
                used_skills: used.iter().map(|id| (*id).to_string()).collect(),
                finish_position: 2000.0,
                ..BasinRoundData::default()
            }],
        }
    }

    #[test]
    fn the_window_measures_only_the_ground_taken_inside_it() {
        let baseline = vec![0.0, 100.0, 200.0, 300.0];
        let candidate = vec![0.0, 102.5, 205.0, 307.5];
        let window = EvaluationWindow {
            start_distance: 100.0,
            end_distance: 300.0,
        };

        // 7.5 m gained by the finish, 2.5 m of it before the window opened, so
        // 5 m belongs to the window: two bashin.
        let delta = bashin_delta_over_window(&baseline, &candidate, window).unwrap();
        assert_eq!(delta, 2.0);
    }

    #[test]
    fn a_window_beyond_the_race_measures_nothing() {
        let baseline = vec![0.0, 100.0];
        let candidate = vec![0.0, 110.0];
        let window = EvaluationWindow {
            start_distance: 5000.0,
            end_distance: 6000.0,
        };

        assert_eq!(
            bashin_delta_over_window(&baseline, &candidate, window),
            Some(0.0)
        );
    }

    fn round_with_logs(seed: u64, skill_id: &str, start: f64, end: f64) -> BasinRound {
        let mut round = basin_round(seed, vec![0.0, 1000.0], &[skill_id]);
        round.runners[0].skill_activations.insert(
            skill_id.to_string(),
            vec![SkillEffectLog {
                execution_id: "0".to_string(),
                skill_id: skill_id.to_string(),
                start,
                end,
                perspective: EffectPerspective::SelfCast,
                effect_type: 27,
                effect_target: 1,
            }],
        );
        round
    }

    #[test]
    fn recorded_activations_supply_the_positions_and_no_fallback_runs() {
        let mut summary = SkillCompareSummary::new();
        let baseline = basin_round(7, vec![0.0, 1000.0], &[]);
        let tracked = round_with_logs(7, "200011", 400.0, 500.0);

        summary
            .observe(
                &baseline,
                &tracked,
                "200011",
                FallbackEffect {
                    effect_type: 27,
                    effect_target: 1,
                },
                EvaluationWindow {
                    start_distance: 0.0,
                    end_distance: 2000.0,
                },
            )
            .unwrap();

        let data = summary.finish();
        assert_eq!(data.tracked_meta.len(), 1);
        assert_eq!(data.tracked_meta[0].positions, vec![400.0]);
    }

    #[test]
    fn a_used_skill_without_a_log_falls_back_to_the_finish() {
        let mut summary = SkillCompareSummary::new();
        let baseline = basin_round(7, vec![0.0, 1000.0], &[]);
        let tracked = basin_round(7, vec![0.0, 1000.0], &["200011"]);

        summary
            .observe(
                &baseline,
                &tracked,
                "200011",
                FallbackEffect {
                    effect_type: 27,
                    effect_target: 1,
                },
                EvaluationWindow {
                    start_distance: 0.0,
                    end_distance: 2000.0,
                },
            )
            .unwrap();

        let data = summary.finish();
        assert_eq!(data.tracked_meta.len(), 1);
        // The series ends short of the finish line, so the marker sits at the
        // last recorded position rather than past the race.
        assert_eq!(data.tracked_meta[0].positions, vec![1000.0]);
    }

    #[test]
    fn a_skill_that_never_fired_leaves_no_metadata() {
        let mut summary = SkillCompareSummary::new();
        let baseline = basin_round(7, vec![0.0, 1000.0], &[]);
        let tracked = basin_round(7, vec![0.0, 1010.0], &[]);

        summary
            .observe(
                &baseline,
                &tracked,
                "200011",
                FallbackEffect {
                    effect_type: 27,
                    effect_target: 1,
                },
                EvaluationWindow {
                    start_distance: 0.0,
                    end_distance: 2000.0,
                },
            )
            .unwrap();

        let data = summary.finish();
        assert!(data.tracked_meta.is_empty());
        assert_eq!(data.results, vec![4.0]);
    }

    #[test]
    fn merging_chunks_matches_one_batch() {
        let window = EvaluationWindow {
            start_distance: 0.0,
            end_distance: 2000.0,
        };
        let fallback = FallbackEffect {
            effect_type: 27,
            effect_target: 1,
        };
        let pairs = [
            (
                basin_round(1, vec![0.0, 1000.0], &[]),
                basin_round(1, vec![0.0, 1005.0], &[]),
            ),
            (
                basin_round(2, vec![0.0, 1000.0], &[]),
                basin_round(2, vec![0.0, 1010.0], &[]),
            ),
        ];

        let mut one = SkillCompareSummary::new();
        for (baseline, tracked) in &pairs {
            one.observe(baseline, tracked, "200011", fallback, window)
                .unwrap();
        }

        let mut first = SkillCompareSummary::new();
        first
            .observe(&pairs[0].0, &pairs[0].1, "200011", fallback, window)
            .unwrap();
        let mut second = SkillCompareSummary::new();
        second
            .observe(&pairs[1].0, &pairs[1].1, "200011", fallback, window)
            .unwrap();
        first.merge(second);

        assert_eq!(first.finish(), one.finish());
    }
}
