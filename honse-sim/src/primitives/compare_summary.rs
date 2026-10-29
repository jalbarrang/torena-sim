//! Batch reduction over paired compare telemetry.
//!
//! Both engines project raw per-round telemetry
//! ([`CompareRoundData`](crate::compare::CompareRoundData)). This
//! module is the one place that turns a batch of those pairs into the summary a
//! comparison is read as: the bashin delta between the two runners, the
//! per-runner mechanic spans, the stamina ledger and its sample spreads, and
//! per-skill activation profiles.
//!
//! The accumulator is mergeable —
//! [`observe`](crate::primitives::compare_summary::CompareSummary::observe) per
//! round, [`merge`](crate::primitives::compare_summary::CompareSummary::merge)
//! per chunk — so a caller that splits a batch across workers or across WASM
//! calls still reduces in one implementation. It reads
//! [`CompareRoundData`](crate::compare::CompareRoundData) and nothing else, which
//! is why it lives in `primitives` rather than in either engine: any consumer of
//! either engine gets the same numbers.

use std::collections::BTreeMap;
use std::fmt;

use serde::{Deserialize, Serialize};

use crate::compare::{CompareData, CompareRound, CompareRoundData, PairedCompareData};
use crate::projection::SkillEffectLog;
use crate::stamina::ledger::StaminaLedger;

/// Metres in one bashin (horse length), the unit races are reported in.
pub const BASHIN_METERS: f64 = 2.5;

/// Metres covered by one occupancy bin in an activation profile.
pub const ACTIVATION_BIN_METERS: f64 = 25.0;

/// Convert a gap in metres to bashin.
pub fn meters_to_bashin(meters: f64) -> f64 {
    meters / BASHIN_METERS
}

/// Reasons a round cannot be folded into a summary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SummaryError {
    /// One of the two position series was empty, so no delta can be taken.
    EmptyPositionSeries,
    /// A round did not carry the runner the summary was asked to pair.
    MissingRunner(usize),
}

impl fmt::Display for SummaryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SummaryError::EmptyPositionSeries => {
                write!(f, "position telemetry is empty while computing the delta")
            }
            SummaryError::MissingRunner(index) => {
                write!(f, "a compare round is missing focus runner {index}")
            }
        }
    }
}

impl std::error::Error for SummaryError {}

/// The gap between two position series at their last shared frame.
///
/// `None` when either series is empty. A pair whose frames do not line up is
/// read at the last frame both have, which is what the collector guarantees for
/// two runners in one round.
pub fn compute_position_diff(position_a: &[f64], position_b: &[f64]) -> Option<f64> {
    let last = position_a.len().min(position_b.len());
    if last == 0 {
        return None;
    }

    Some(position_b[last - 1] - position_a[last - 1])
}

/// Bashin gained by `candidate` over `baseline` at the finish, or `None` when
/// either series is empty.
pub fn bashin_delta(baseline: &[f64], candidate: &[f64]) -> Option<f64> {
    transported_delta(baseline, candidate)
}

/// A per-tick value as the read-model transports it.
///
/// `position` and `hp` cross the WASM boundary as `Float32Array` (see
/// `docs/simulation/patterns.md`). The summary measures the narrowed values so
/// the numbers a panel shows agree, to the bit, with the ones a consumer could
/// compute from the series it received — moving the reduction into the engine
/// must not move the answer.
pub(crate) fn as_transported(value: f64) -> f64 {
    f64::from(value as f32)
}

/// The finish-line gap as the read-model reports it, in bashin.
fn transported_delta(baseline: &[f64], candidate: &[f64]) -> Option<f64> {
    let last = baseline.len().min(candidate.len());
    if last == 0 {
        return None;
    }

    let gap = as_transported(candidate[last - 1]) - as_transported(baseline[last - 1]);
    Some(meters_to_bashin(gap))
}

/// One value per sample, summarised.
///
/// `values` stays ascending: a histogram bins it straight through, and the
/// quartiles a reader wants next are index lookups rather than another pass.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleDistribution {
    /// Smallest sample.
    pub min: f64,
    /// Largest sample.
    pub max: f64,
    /// Arithmetic mean.
    pub mean: f64,
    /// Middle sample (the mean of the two middle ones for an even count).
    pub median: f64,
    /// Every sample, ascending.
    pub values: Vec<f64>,
}

impl SampleDistribution {
    /// Summarise `values`, or `None` when there are none.
    ///
    /// The input is consumed and left sorted, because every reader of the spread
    /// wants the sorted form.
    pub fn from_values(mut values: Vec<f64>) -> Option<Self> {
        if values.is_empty() {
            return None;
        }

        values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

        // Summed after sorting so the mean's additions run in the same order a
        // sorted consumer would add them.
        let count = values.len();
        let first = values.first().copied().unwrap_or_default();
        let last = values.last().copied().unwrap_or_default();
        let mean = values.iter().sum::<f64>() / count as f64;
        let middle = count / 2;
        let median = if count.is_multiple_of(2) {
            (values[middle - 1] + values[middle]) / 2.0
        } else {
            values[middle]
        };

        Some(SampleDistribution {
            min: first,
            max: last,
            mean,
            median,
            values,
        })
    }
}

/// Which sample each representative race comes from.
///
/// A comparison draws one race per statistic, so it has to name the sample each
/// number came from. The consumer materialises those races by index.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RepresentativeIndices {
    /// Sample behind the minimum.
    pub min: usize,
    /// Sample behind the maximum.
    pub max: usize,
    /// Sample closest to the mean.
    pub mean: usize,
    /// Sample closest to the median.
    pub median: usize,
}

impl RepresentativeIndices {
    /// Name the sample behind each statistic of `samples`.
    ///
    /// `samples` must stay in **sample order**, index-aligned with the rounds
    /// they were reduced from: these indices name a race to re-run, so they are
    /// positions in the batch, not ranks in a sorted distribution. Min and max
    /// are attained by a sample, so their index is exact; mean and median sit
    /// between samples, so theirs is the closest one and a tie goes to the
    /// earlier race.
    pub fn of(samples: &[f64]) -> Option<Self> {
        let distribution = SampleDistribution::from_values(samples.to_vec())?;

        let exact = |target: f64| {
            samples
                .iter()
                .position(|value| *value == target)
                .unwrap_or(0)
        };
        let nearest = |target: f64| {
            let mut nearest = 0;
            let mut nearest_diff = f64::INFINITY;
            for (index, value) in samples.iter().enumerate() {
                let diff = (value - target).abs();
                if diff < nearest_diff {
                    nearest_diff = diff;
                    nearest = index;
                }
            }
            nearest
        };

        Some(RepresentativeIndices {
            min: exact(distribution.min),
            max: exact(distribution.max),
            mean: nearest(distribution.mean),
            median: nearest(distribution.median),
        })
    }
}

/// Span statistics for one boolean-ish mechanic across the batch.
///
/// `frequency` is the share of samples the mechanic occurred in, as a
/// percentage of every sample run — not of the samples it occurred in.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct SpanStats {
    /// Shortest occurrence.
    pub min: f64,
    /// Longest occurrence.
    pub max: f64,
    /// Mean occurrence.
    pub mean: f64,
    /// Share of samples it occurred in, as a percentage.
    pub frequency: f64,
}

/// One mechanic's collected spans, before the batch is complete.
#[derive(Debug, Clone, Default, PartialEq)]
struct SpanAccumulator {
    lengths: Vec<f64>,
    count: usize,
}

impl SpanAccumulator {
    fn push(&mut self, length: f64) {
        self.lengths.push(length);
        self.count += 1;
    }

    fn merge(&mut self, other: Self) {
        self.lengths.extend(other.lengths);
        self.count += other.count;
    }

    fn finish(&self, samples: usize) -> SpanStats {
        let Some(first) = self.lengths.first().copied() else {
            return SpanStats::default();
        };

        let mut min = first;
        let mut max = first;
        let mut total = 0.0;
        for length in &self.lengths {
            min = min.min(*length);
            max = max.max(*length);
            total += *length;
        }

        SpanStats {
            min,
            max,
            mean: total / self.lengths.len() as f64,
            frequency: if samples > 0 {
                (self.count as f64 / samples as f64) * 100.0
            } else {
                0.0
            },
        }
    }
}

/// The mean of every per-round stamina ledger, and how many rounds carried one.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerSummary {
    /// HP the runner would have spent with no status mechanic active.
    pub baseline_spent: f64,
    /// HP actually drained.
    pub total_spent: f64,
    /// Attributed to downhill mode. Negative: a saving.
    pub downhill: f64,
    /// Attributed to being rushed.
    pub rushed: f64,
    /// Attributed to spot struggle.
    pub spot_struggle: f64,
    /// Attributed to pace-down. Negative: a saving.
    pub pace_down: f64,
    /// Attributed to speed-raising position keeping.
    pub pace_up: f64,
    /// Attributed to dueling.
    pub dueling: f64,
    /// HP restored by recovery effects.
    pub total_recovered: f64,
    /// HP removed by negative-modifier effects.
    pub total_drained_by_effects: f64,
    /// Recovery effects that actually restored HP, as a batch mean.
    pub recovery_procs: f64,
    /// Max HP for the run.
    pub max_hp: f64,
}

/// Ledger sums plus the number of contributing rounds.
///
/// Rows are kept rather than a running sum so the mean's additions run in round
/// order however the batch was split: two chunks reduced separately and merged
/// must land on the same mean one pass would, and float addition is not
/// associative.
#[derive(Debug, Clone, Default, PartialEq)]
struct LedgerAccumulator {
    rows: Vec<[f64; LEDGER_FIELDS]>,
}

/// The summable numeric fields of a ledger, in the order [`LedgerSummary`]
/// declares them. The two spurt-decision facts are per-run, not attributions,
/// and are read as their own sample spreads instead of a batch mean.
const LEDGER_FIELDS: usize = 12;

impl LedgerAccumulator {
    fn add(&mut self, ledger: &StaminaLedger) {
        self.rows.push([
            ledger.baseline_spent,
            ledger.total_spent,
            ledger.downhill,
            ledger.rushed,
            ledger.spot_struggle,
            ledger.pace_down,
            ledger.pace_up,
            ledger.dueling,
            ledger.total_recovered,
            ledger.total_drained_by_effects,
            f64::from(ledger.recovery_procs),
            ledger.max_hp,
        ]);
    }

    fn merge(&mut self, other: Self) {
        self.rows.extend(other.rows);
    }

    /// A mean rather than a representative run: one round's downhill luck is
    /// not the question a player is asking. `None` when no round carried one,
    /// which is what tells a reader to say "unavailable" instead of zero.
    fn finish(&self) -> Option<LedgerSummary> {
        if self.rows.is_empty() {
            return None;
        }

        let mut sums = [0.0; LEDGER_FIELDS];
        for row in &self.rows {
            for (index, value) in row.iter().enumerate() {
                if let Some(slot) = sums.get_mut(index) {
                    *slot += *value;
                }
            }
        }

        let divisor = self.rows.len() as f64;
        let field = |index: usize| sums.get(index).copied().unwrap_or_default() / divisor;

        Some(LedgerSummary {
            baseline_spent: field(0),
            total_spent: field(1),
            downhill: field(2),
            rushed: field(3),
            spot_struggle: field(4),
            pace_down: field(5),
            pace_up: field(6),
            dueling: field(7),
            total_recovered: field(8),
            total_drained_by_effects: field(9),
            recovery_procs: field(10),
            max_hp: field(11),
        })
    }
}

/// What one skill did across every sampled race, rather than in any single one.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillActivationSummary {
    /// Share of samples the skill fired in, as a percentage.
    pub rate: f64,
    /// Median distance of the first activation, in metres.
    pub median_start: f64,
    /// Median distance the effect covered, in metres.
    pub median_duration: f64,
    /// Share of samples (0-1) the skill was active during each
    /// [`ACTIVATION_BIN_METERS`] stretch, indexed from the start line.
    pub occupancy: Vec<f64>,
}

/// One skill's running tally across the batch.
///
/// `bin_hits` counts samples, not activations: a bin is credited once per sample
/// however many times the skill re-fired inside it, so the counts divide into
/// probabilities.
#[derive(Debug, Clone, Default, PartialEq)]
struct ActivationAccumulator {
    samples: usize,
    starts: Vec<f64>,
    durations: Vec<f64>,
    bin_hits: Vec<u32>,
}

impl ActivationAccumulator {
    fn add(&mut self, logs: &[SkillEffectLog]) {
        if logs.is_empty() {
            return;
        }

        self.samples += 1;

        // Duration comes from the first activation only: a skill that fires
        // twice has two separate effects, and summing them would report a
        // duration no single proc ever had.
        if let Some(first) = logs.first() {
            self.starts.push(first.start);
            self.durations.push(first.end - first.start);
        }

        // Bins are per sample: collect the covered ones, then credit each once.
        let mut covered: Vec<usize> = Vec::new();
        for log in logs {
            let first_bin = bin_of(log.start);
            let last_bin = bin_of(log.end).max(first_bin);
            for bin in first_bin..=last_bin {
                if self.bin_hits.len() <= bin {
                    self.bin_hits.resize(bin + 1, 0);
                }
                if !covered.contains(&bin) {
                    covered.push(bin);
                }
            }
        }
        for bin in covered {
            if let Some(hits) = self.bin_hits.get_mut(bin) {
                *hits += 1;
            }
        }
    }

    fn merge(&mut self, other: Self) {
        self.samples += other.samples;
        self.starts.extend(other.starts);
        self.durations.extend(other.durations);

        if self.bin_hits.len() < other.bin_hits.len() {
            self.bin_hits.resize(other.bin_hits.len(), 0);
        }
        for (index, hits) in other.bin_hits.iter().enumerate() {
            if let Some(target) = self.bin_hits.get_mut(index) {
                *target += hits;
            }
        }
    }

    fn finish(&self, samples: usize) -> SkillActivationSummary {
        if samples == 0 {
            return SkillActivationSummary::default();
        }

        let divisor = samples as f64;
        SkillActivationSummary {
            rate: (self.samples as f64 / divisor) * 100.0,
            median_start: median_of(&self.starts),
            median_duration: median_of(&self.durations),
            occupancy: self
                .bin_hits
                .iter()
                .map(|hits| f64::from(*hits) / divisor)
                .collect(),
        }
    }
}

/// The occupancy bin a distance falls in, clamped at the start line.
fn bin_of(distance: f64) -> usize {
    let bin = (distance / ACTIVATION_BIN_METERS).floor();
    if bin <= 0.0 {
        0
    } else {
        // A course is far shorter than `usize::MAX` bins, and the clamp keeps a
        // stray sentinel distance from reserving an enormous vector.
        bin.min(1_000_000.0) as usize
    }
}

/// Median of an unsorted list, or 0 for an empty one.
fn median_of(values: &[f64]) -> f64 {
    let Some(distribution) = SampleDistribution::from_values(values.to_vec()) else {
        return 0.0;
    };
    distribution.median
}

/// One runner's half of the batch.
#[derive(Debug, Clone, Default, PartialEq)]
struct RunnerSummary {
    total: usize,
    hp_died: usize,
    full_spurt: usize,
    first_late: usize,
    ledger: LedgerAccumulator,
    rushed: SpanAccumulator,
    fully_charged: SpanAccumulator,
    lead_competition: SpanAccumulator,
    dueling: SpanAccumulator,
    remaining_hp: Vec<f64>,
    lowest_hp: Vec<f64>,
    out_of_hp_position: Vec<f64>,
    downhill_save: Vec<f64>,
    spurt_margin: Vec<f64>,
    spurt_hp_required: Vec<f64>,
    required_hp: Vec<f64>,
    /// The margin, index-aligned with the rounds, so the representative races
    /// can be named from it. A round without one stores `None`, which
    /// disqualifies the whole selection rather than shifting later samples.
    spurt_margin_by_round: Vec<Option<f64>>,
    activations: BTreeMap<String, ActivationAccumulator>,
}

impl RunnerSummary {
    fn observe(&mut self, round: &CompareRoundData) {
        self.total += 1;
        if round.out_of_hp {
            self.hp_died += 1;
        }
        if round.has_achieved_full_spurt {
            self.full_spurt += 1;
        }
        if round.first_position_in_late_race {
            self.first_late += 1;
        }

        if let Some(first) = round.rushed.first() {
            self.rushed.push(first.1 - first.0);
        }
        if round.fully_charged_region.is_some() {
            if let Some(accel) = round.fully_charged_accel {
                self.fully_charged.push(accel);
            }
        }
        if let Some((start, end)) = round.spot_struggle_region {
            self.lead_competition.push(end - start);
        }
        if let Some((start, end)) = round.dueling_region {
            self.dueling.push(end - start);
        }

        self.record_stamina(round);
        self.record_activations(round);
    }

    fn record_stamina(&mut self, round: &CompareRoundData) {
        if let Some(last_hp) = round.hp.last().copied() {
            self.remaining_hp.push(as_transported(last_hp));
            if let Some(lowest) = round.hp.iter().copied().reduce(f64::min) {
                self.lowest_hp.push(as_transported(lowest));
            }
        }

        if let Some(position) = round.out_of_hp_position {
            self.out_of_hp_position.push(position);
        }

        // One entry per round, whatever the round recorded, so an index into it
        // is still the round the drawn race comes from.
        self.spurt_margin_by_round
            .push(round.stamina_ledger.as_ref().and_then(|l| l.spurt_margin));

        let Some(ledger) = round.stamina_ledger.as_ref() else {
            return;
        };

        // The ledger reports a saving as negative; the summary states it as HP
        // saved.
        self.downhill_save.push(-ledger.downhill);
        self.ledger.add(ledger);

        let Some(margin) = ledger.spurt_margin else {
            return;
        };

        self.spurt_margin.push(margin);
        self.required_hp.push(ledger.max_hp - margin);
        if let Some(required) = ledger.spurt_hp_required {
            self.spurt_hp_required.push(required);
        }
    }

    fn record_activations(&mut self, round: &CompareRoundData) {
        for (skill_id, logs) in &round.skill_activations {
            self.activations
                .entry(skill_id.clone())
                .or_default()
                .add(logs);
        }
    }

    fn merge(&mut self, other: Self) {
        self.total += other.total;
        self.hp_died += other.hp_died;
        self.full_spurt += other.full_spurt;
        self.first_late += other.first_late;
        self.ledger.merge(other.ledger);
        self.rushed.merge(other.rushed);
        self.fully_charged.merge(other.fully_charged);
        self.lead_competition.merge(other.lead_competition);
        self.dueling.merge(other.dueling);
        self.remaining_hp.extend(other.remaining_hp);
        self.lowest_hp.extend(other.lowest_hp);
        self.out_of_hp_position.extend(other.out_of_hp_position);
        self.downhill_save.extend(other.downhill_save);
        self.spurt_margin.extend(other.spurt_margin);
        self.spurt_hp_required.extend(other.spurt_hp_required);
        self.required_hp.extend(other.required_hp);
        self.spurt_margin_by_round
            .extend(other.spurt_margin_by_round);

        for (skill_id, accumulator) in other.activations {
            self.activations
                .entry(skill_id)
                .or_default()
                .merge(accumulator);
        }
    }

    fn finish(&self, samples: usize) -> RunnerSummaryData {
        let rate = |count: usize| {
            if samples > 0 {
                (count as f64 / samples as f64) * 100.0
            } else {
                0.0
            }
        };

        RunnerSummaryData {
            stamina_survival_rate: rate(self.total.saturating_sub(self.hp_died)),
            full_spurt_rate: rate(self.full_spurt),
            first_place_rate: rate(self.first_late),
            mean_ledger: self.ledger.finish(),
            remaining_hp: SampleDistribution::from_values(self.remaining_hp.clone()),
            lowest_hp: SampleDistribution::from_values(self.lowest_hp.clone()),
            out_of_hp_position: SampleDistribution::from_values(self.out_of_hp_position.clone()),
            downhill_save: SampleDistribution::from_values(self.downhill_save.clone()),
            spurt_margin: SampleDistribution::from_values(self.spurt_margin.clone()),
            spurt_hp_required: SampleDistribution::from_values(self.spurt_hp_required.clone()),
            required_hp: SampleDistribution::from_values(self.required_hp.clone()),
            runs: representative_of_by_round(&self.spurt_margin_by_round),
            activations: self
                .activations
                .iter()
                .map(|(skill_id, accumulator)| (skill_id.clone(), accumulator.finish(samples)))
                .collect(),
            rushed: self.rushed.finish(samples),
            fully_charged: self.fully_charged.finish(samples),
            lead_competition: self.lead_competition.finish(samples),
            dueling: self.dueling.finish(samples),
        }
    }
}

/// Representative races for a series that may have gaps.
///
/// `None` when there is no sample, or when any round is missing one: a name for
/// a race that does not exist would be worse than saying "unavailable".
fn representative_of_by_round(samples: &[Option<f64>]) -> Option<RepresentativeIndices> {
    let mut values = Vec::with_capacity(samples.len());
    for sample in samples {
        values.push((*sample)?);
    }

    RepresentativeIndices::of(&values)
}

/// One runner's finished half.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunnerSummaryData {
    /// Share of samples that did not run out of HP, as a percentage.
    pub stamina_survival_rate: f64,
    /// Share of samples that reached a full last spurt, as a percentage.
    pub full_spurt_rate: f64,
    /// Share of samples holding first entering the late race, as a percentage.
    pub first_place_rate: f64,
    /// The HP ledger averaged over every sample, or `None` when none recorded one.
    pub mean_ledger: Option<LedgerSummary>,
    /// HP left at the finish, one entry per sample.
    pub remaining_hp: Option<SampleDistribution>,
    /// The lowest HP each sample reached.
    pub lowest_hp: Option<SampleDistribution>,
    /// Metres left to run when HP ran out, one entry per sample that ran dry.
    pub out_of_hp_position: Option<SampleDistribution>,
    /// HP downhill mode saved, as a positive magnitude.
    pub downhill_save: Option<SampleDistribution>,
    /// HP left over at the last-spurt decision.
    pub spurt_margin: Option<SampleDistribution>,
    /// The bar each sample needed: spend up to the decision plus the spurt bill.
    pub spurt_hp_required: Option<SampleDistribution>,
    /// The bar each sample had to cover, `max_hp - spurt_margin` per sample.
    pub required_hp: Option<SampleDistribution>,
    /// Which samples the stamina panels draw, or `None` when a round lacks one.
    pub runs: Option<RepresentativeIndices>,
    /// Per-skill activation profiles, keyed by skill id.
    pub activations: BTreeMap<String, SkillActivationSummary>,
    /// Rushed spans.
    pub rushed: SpanStats,
    /// Fully Charged release accel spans.
    pub fully_charged: SpanStats,
    /// Spot-struggle spans.
    pub lead_competition: SpanStats,
    /// Dueling spans.
    pub dueling: SpanStats,
}

/// The finished batch summary.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct CompareSummaryData {
    /// One bashin delta per sample, ascending.
    pub results: Vec<f64>,
    /// How many samples the summary covers.
    pub samples: usize,
    /// Which samples the chart draws for each statistic.
    pub representative: Option<RepresentativeIndices>,
    /// The first compared runner.
    pub uma1: RunnerSummaryData,
    /// The second compared runner.
    pub uma2: RunnerSummaryData,
}

/// A mergeable reduction of paired compare rounds.
///
/// Fold rounds with [`observe`](Self::observe) as the batch runs, and
/// [`merge`](Self::merge) chunk accumulators together. [`finish`](Self::finish)
/// produces the read-model once the whole batch is in, because the
/// representative samples and the percentages are only meaningful then.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CompareSummary {
    deltas: Vec<f64>,
    uma1: RunnerSummary,
    uma2: RunnerSummary,
}

impl CompareSummary {
    /// An empty summary.
    pub fn new() -> Self {
        Self::default()
    }

    /// Fold one round's paired runners into the summary.
    pub fn observe(
        &mut self,
        round_a: &CompareRoundData,
        round_b: &CompareRoundData,
    ) -> Result<(), SummaryError> {
        let delta = transported_delta(&round_a.position, &round_b.position)
            .ok_or(SummaryError::EmptyPositionSeries)?;

        self.deltas.push(delta);
        self.uma1.observe(round_a);
        self.uma2.observe(round_b);
        Ok(())
    }

    /// Fold a whole collected batch, pairing each round's runners at `first`
    /// and `second`.
    pub fn observe_batch(
        &mut self,
        data: &CompareData,
        first: usize,
        second: usize,
    ) -> Result<(), SummaryError> {
        for round in &data.rounds {
            let round_a = round
                .runners
                .get(first)
                .ok_or(SummaryError::MissingRunner(first))?;
            let round_b = round
                .runners
                .get(second)
                .ok_or(SummaryError::MissingRunner(second))?;
            self.observe(round_a, round_b)?;
        }

        Ok(())
    }

    /// Fold a paired batch: two races of the same rounds, one contestant each.
    pub fn observe_paired_batch(&mut self, paired: &PairedCompareData) -> Result<(), SummaryError> {
        for (round_a, round_b) in paired.first.rounds.iter().zip(paired.second.rounds.iter()) {
            let runner_a = round_a
                .runners
                .first()
                .ok_or(SummaryError::MissingRunner(0))?;
            let runner_b = round_b
                .runners
                .first()
                .ok_or(SummaryError::MissingRunner(0))?;
            self.observe(runner_a, runner_b)?;
        }

        Ok(())
    }

    /// Fold another chunk's summary in, keeping sample order.
    pub fn merge(&mut self, other: Self) {
        self.deltas.extend(other.deltas);
        self.uma1.merge(other.uma1);
        self.uma2.merge(other.uma2);
    }

    /// How many samples the summary holds.
    pub fn samples(&self) -> usize {
        self.deltas.len()
    }
    /// The finished read-model, leaving the accumulator reusable.
    pub fn to_data(&self) -> CompareSummaryData {
        self.clone().finish()
    }

    /// The finished read-model.
    pub fn finish(self) -> CompareSummaryData {
        let samples = self.deltas.len();
        // Named from the round-ordered deltas, not the sorted distribution: a
        // representative race is a position in the batch.
        let representative = RepresentativeIndices::of(&self.deltas);
        let distribution = SampleDistribution::from_values(self.deltas);

        CompareSummaryData {
            results: distribution
                .as_ref()
                .map(|d| d.values.clone())
                .unwrap_or_default(),
            samples,
            representative,
            uma1: self.uma1.finish(samples),
            uma2: self.uma2.finish(samples),
        }
    }
}

/// Fold a batch of collected rounds into the finished read-model.
///
/// `first` and `second` are indices into each round's focus runners, which is
/// how a caller says which two of them the comparison is between. Both engines
/// collect the compared pair first, so the usual call is `(0, 1)`.
pub fn summarize_rounds(
    rounds: &[CompareRound],
    first: usize,
    second: usize,
) -> Result<CompareSummaryData, SummaryError> {
    let mut summary = CompareSummary::new();

    for round in rounds {
        let round_a = round
            .runners
            .get(first)
            .ok_or(SummaryError::MissingRunner(first))?;
        let round_b = round
            .runners
            .get(second)
            .ok_or(SummaryError::MissingRunner(second))?;
        summary.observe(round_a, round_b)?;
    }

    Ok(summary.finish())
}
/// Fold a [`CompareData`] batch into the finished read-model, pairing its first
/// two focus runners.
pub fn summarize_compare(data: &CompareData) -> Result<CompareSummaryData, SummaryError> {
    summarize_rounds(&data.rounds, 0, 1)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::disallowed_methods)]

    use super::*;

    fn round(runner_id: u32, position: Vec<f64>) -> CompareRoundData {
        CompareRoundData {
            runner_id,
            position,
            ..CompareRoundData::default()
        }
    }

    #[test]
    fn position_diff_reads_the_last_shared_frame() {
        let diff = compute_position_diff(&[0.0, 10.0, 20.0], &[0.0, 11.0, 25.0, 40.0]);
        assert_eq!(diff, Some(5.0));
    }

    #[test]
    fn empty_position_series_is_an_error() {
        let mut summary = CompareSummary::new();
        let error = summary
            .observe(&round(1, Vec::new()), &round(2, vec![1.0]))
            .unwrap_err();
        assert_eq!(error, SummaryError::EmptyPositionSeries);
    }

    #[test]
    fn delta_is_measured_in_bashin() {
        let mut summary = CompareSummary::new();
        summary
            .observe(&round(1, vec![0.0, 100.0]), &round(2, vec![0.0, 105.0]))
            .unwrap();
        let data = summary.finish();
        assert_eq!(data.results, vec![2.0]);
        assert_eq!(data.samples, 1);
    }

    #[test]
    fn merge_keeps_every_sample_in_order() {
        let mut first = CompareSummary::new();
        first
            .observe(&round(1, vec![0.0]), &round(2, vec![10.0]))
            .unwrap();
        let mut second = CompareSummary::new();
        second
            .observe(&round(1, vec![0.0]), &round(2, vec![2.5]))
            .unwrap();

        first.merge(second);
        let data = first.finish();
        assert_eq!(data.samples, 2);
        // Ascending, so a histogram bins the sample straight through.
        assert_eq!(data.results, vec![1.0, 4.0]);
    }

    #[test]
    fn representative_indices_name_the_sample_behind_each_statistic() {
        // Round order: 5, 1, 9, 3. Min is the second race, max the third.
        let indices = RepresentativeIndices::of(&[5.0, 1.0, 9.0, 3.0]).unwrap();

        assert_eq!(indices.min, 1);
        assert_eq!(indices.max, 2);
        // Mean 4.5 sits between 5 (index 0) and 3 (index 3); the earlier wins.
        assert_eq!(indices.mean, 0);
        assert_eq!(indices.median, 0);
    }

    #[test]
    fn a_round_without_a_margin_disqualifies_the_stamina_runs() {
        let mut summary = CompareSummary::new();
        let mut first = round(1, vec![0.0]);
        first.stamina_ledger = Some(StaminaLedger {
            spurt_margin: Some(12.0),
            max_hp: 3000.0,
            ..StaminaLedger::default()
        });
        summary.observe(&first, &round(2, vec![0.0])).unwrap();
        summary
            .observe(&round(1, vec![0.0]), &round(2, vec![0.0]))
            .unwrap();

        let data = summary.finish();
        assert!(data.uma1.spurt_margin.is_some());
        assert!(data.uma1.runs.is_none());
        assert!(data.uma2.runs.is_none());
        assert_eq!(data.uma1.required_hp.unwrap().values, vec![2988.0]);
    }

    #[test]
    fn span_stats_divide_by_every_sample_not_by_occurrences() {
        let mut summary = CompareSummary::new();
        let mut rushed = round(1, vec![0.0]);
        rushed.rushed = vec![(10.0, 13.0)];
        summary.observe(&rushed, &round(2, vec![0.0])).unwrap();
        summary
            .observe(&round(1, vec![0.0]), &round(2, vec![0.0]))
            .unwrap();

        let data = summary.finish();
        assert_eq!(data.uma1.rushed.min, 3.0);
        assert_eq!(data.uma1.rushed.max, 3.0);
        // One of two samples, not one of one.
        assert_eq!(data.uma1.rushed.frequency, 50.0);
        assert_eq!(data.uma1.rushed.mean, 3.0);
        assert_eq!(data.uma2.rushed.frequency, 0.0);
    }

    #[test]
    fn activation_profiles_bin_per_sample_not_per_activation() {
        let mut summary = CompareSummary::new();
        let mut round_a = round(1, vec![0.0]);
        round_a.skill_activations.insert(
            "200011".to_string(),
            vec![SkillEffectLog {
                execution_id: "0".to_string(),
                skill_id: "200011".to_string(),
                start: 10.0,
                end: 60.0,
                perspective: crate::projection::EffectPerspective::SelfCast,
                effect_type: 27,
                effect_target: 1,
            }],
        );
        summary.observe(&round_a, &round(2, vec![0.0])).unwrap();

        let data = summary.finish();
        let profile = data.uma1.activations.get("200011").unwrap();
        assert_eq!(profile.rate, 100.0);
        assert_eq!(profile.median_start, 10.0);
        assert_eq!(profile.median_duration, 50.0);
        // Bins 0..=2 are covered by 10m..60m; each credited once.
        assert_eq!(profile.occupancy, vec![1.0, 1.0, 1.0]);
    }
}
