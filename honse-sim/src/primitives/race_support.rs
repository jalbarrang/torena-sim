//! Field-agnostic race-orchestration **support** shared by both engines
//! (ADR-0005).
//!
//! The per-frame field snapshot, the per-runner field view, and the small
//! producer leaf-helpers (side-block / overtake proximity reads, approximate
//! condition reads) are pure mechanics over runner positions — they never ask
//! which paradigm is running. Both the contested module (contested) and
//! the vacuum module (synthetic) reuse them so the snapshot machinery cannot
//! drift between engines; each engine differs only in how it *produces*
//! [`FieldInputs`](crate::runner::physics::FieldInputs) from this support.

use std::collections::HashMap;

use crate::pacing::select_pacer;
use crate::runner::physics::RunnerSnapshot;
use crate::runner::skills::FieldView;
use crate::runner::Runner;
use crate::shared_kernel::ids::RunnerId;
use crate::shared_kernel::language::{strategy_matches, Strategy};
use crate::shared_kernel::rng::Prng;
use crate::skills::condition::dynamic::{ActiveRunner, RunnerSnapshot as DynRunnerSnapshot};
use crate::skills::effect::SkillTarget;

/// A read-only snapshot of the whole field, frozen at the start of a frame.
pub struct FieldSnapshot {
    /// Active (unfinished) runners' frozen per-frame state.
    pub entries: Vec<SnapEntry>,
    /// Current finishing order (1-based), with forced-rank overrides applied.
    pub order: HashMap<RunnerId, i64>,
    /// Previous-frame finishing order.
    pub previous_order: HashMap<RunnerId, i64>,
    /// The selected pacer, if any.
    pub pacer: Option<RunnerId>,
    /// The pacer's current position.
    pub pacer_position: Option<f64>,
    /// The pacer's post-promotion position-keep strategy.
    pub pacer_strategy: Option<Strategy>,
    /// Position of the second-furthest-forward runner.
    pub second_place_position: Option<f64>,
    /// Position of the furthest-forward runner.
    pub leader_position: Option<f64>,
    /// Number of active runners.
    pub num_active: i64,
    /// Total field size (finished + active). Used as `num_umas` for order
    /// conditions so thresholds do not shrink as runners cross the line.
    pub num_total: i64,
}

/// One active runner's frozen per-frame state.
#[derive(Clone, Copy)]
pub struct SnapEntry {
    /// Runner id.
    pub id: RunnerId,
    /// Longitudinal position.
    pub position: f64,
    /// Lateral lane offset.
    pub current_lane: f64,
    /// Current speed.
    pub current_speed: f64,
    /// Immutable running style.
    pub strategy: Strategy,
    /// Starting gate.
    pub gate: i64,
    /// Whether the runner is rushed.
    pub is_rushed: bool,
    /// Whether the runner is dueling.
    pub is_dueling: bool,
    /// Bitmask of positive self-applied effect types activated so far.
    pub activated_advantage_effect_types: u64,
}

/// The aggregate's running pacer + finishing-order state, threaded across frames.
#[derive(Default)]
pub struct FieldOrderTracker {
    /// Current pacer id.
    pub pacer: Option<RunnerId>,
    /// Current pacer position (for the observation view).
    pub pacer_position: Option<f64>,
    /// Current finishing order.
    pub runner_order: HashMap<RunnerId, i64>,
    /// Previous-tick finishing order.
    pub previous_runner_order: HashMap<RunnerId, i64>,
}

impl FieldOrderTracker {
    /// A fresh tracker (no pacer, empty order maps).
    pub fn new() -> Self {
        Self::default()
    }

    /// Reset to the pre-round state.
    pub fn reset(&mut self) {
        self.pacer = None;
        self.pacer_position = None;
        self.runner_order.clear();
        self.previous_runner_order.clear();
    }
}

/// Build the immutable field snapshot for this frame: resolve + apply pacer
/// promotion (mutating one runner's keep-strategy), then freeze every active
/// runner's state and refresh the order maps in `tracker`.
pub fn build_field_snapshot(
    runners: &mut [Runner],
    finished_runners: &[RunnerId],
    tracker: &mut FieldOrderTracker,
) -> FieldSnapshot {
    // Resolve + apply pacer promotion (mutates one runner's keep-strategy).
    let selection = select_pacer(runners, tracker.pacer);
    let mut pacer_strategy = None;
    if let Some(sel) = selection {
        if sel.promote_to_front_runner {
            if let Some(runner) = runners.iter_mut().find(|r| r.id == sel.runner_id) {
                runner.position_keep_strategy = Strategy::FrontRunner;
            }
        }
        tracker.pacer = Some(sel.runner_id);
        if let Some(runner) = runners.iter().find(|r| r.id == sel.runner_id) {
            tracker.pacer_position = Some(runner.position);
            pacer_strategy = Some(runner.position_keep_strategy);
        } else {
            tracker.pacer_position = None;
        }
    } else {
        tracker.pacer = None;
        tracker.pacer_position = None;
    }

    let entries: Vec<SnapEntry> = runners
        .iter()
        .filter(|r| !finished_runners.contains(&r.id))
        .map(|r| SnapEntry {
            id: r.id,
            position: r.position,
            current_lane: r.current_lane,
            current_speed: r.current_speed,
            strategy: r.strategy,
            gate: r.gate,
            is_rushed: r.is_rushed,
            is_dueling: r.is_dueling,
            activated_advantage_effect_types: r.activated_advantage_effect_types,
        })
        .collect();

    // Order by position descending.
    let mut sorted: Vec<&SnapEntry> = entries.iter().collect();
    sorted.sort_by(|a, b| {
        b.position
            .partial_cmp(&a.position)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let previous_order = std::mem::take(&mut tracker.runner_order);
    let mut order: HashMap<RunnerId, i64> = HashMap::new();
    // Finished runners hold the top places (in finish order); runners still on
    // course are ranked behind them. Without this, the order map only ranks
    // active runners, so a trailing runner becomes "order 1" the moment the real
    // leaders cross the line — wrongly satisfying in-the-lead skill gates (e.g.
    // an `order==1` unique) at the very end of the race.
    let finished_count = finished_runners.len() as i64;
    for (place, id) in finished_runners.iter().enumerate() {
        order.insert(*id, place as i64 + 1);
    }
    for (i, entry) in sorted.iter().enumerate() {
        order.insert(entry.id, finished_count + i as i64 + 1);
    }
    // Forced-rank overrides.
    for runner in runners.iter() {
        for region in &runner.forced_rank {
            if runner.position >= region.start && runner.position < region.end {
                order.insert(runner.id, region.rank);
                break;
            }
        }
    }
    tracker.runner_order = order.clone();
    tracker.previous_runner_order = previous_order.clone();

    let leader_position = sorted.first().map(|e| e.position);
    let second_place_position = sorted.get(1).map(|e| e.position);

    let num_active = entries.len() as i64;
    FieldSnapshot {
        num_active,
        num_total: finished_count + num_active,
        entries,
        order,
        previous_order,
        pacer: tracker.pacer,
        pacer_position: tracker.pacer_position,
        pacer_strategy,
        second_place_position,
        leader_position,
    }
}

/// Project the frozen snapshot into the proximity-snapshot list the step's
/// lane-movement / side-block reads consume.
pub fn proximity_snapshots(snapshot: &FieldSnapshot) -> Vec<RunnerSnapshot> {
    snapshot
        .entries
        .iter()
        .map(|e| RunnerSnapshot {
            id: e.id,
            position: e.position,
            current_lane: e.current_lane,
            current_speed: e.current_speed,
        })
        .collect()
}

/// Build the per-runner [`FieldView`] from the frozen snapshot.
pub fn build_field_view(self_id: RunnerId, snapshot: &FieldSnapshot) -> FieldView {
    let other_snapshots: Vec<DynRunnerSnapshot> = snapshot
        .entries
        .iter()
        .filter(|e| e.id != self_id)
        .map(|e| DynRunnerSnapshot {
            position: e.position,
            current_lane: e.current_lane,
            current_speed: e.current_speed,
        })
        .collect();
    let active_runners: Vec<ActiveRunner> = snapshot
        .entries
        .iter()
        .map(|e| ActiveRunner {
            is_self: e.id == self_id,
            position: e.position,
            strategy: e.strategy,
            gate: e.gate,
            is_rushed: e.is_rushed,
            is_dueling: e.is_dueling,
            activated_advantage_effect_types: e.activated_advantage_effect_types,
        })
        .collect();
    FieldView {
        self_order: snapshot.order.get(&self_id).copied(),
        self_previous_order: snapshot.previous_order.get(&self_id).copied(),
        num_umas: snapshot.num_total,
        leader_position: snapshot.leader_position,
        other_snapshots,
        active_runners,
    }
}

/// Resolve the target runner ids for an external debuff emitted by `source_id`,
/// reading the frozen field snapshot. The caster is never a target, and finished
/// runners (absent from `entries`) are never hit.
///
/// Only the targets reachable by the self-activation routing path are modeled:
/// `EnemyStrategy` (the Hesitant family) and `KakariStrategy` (the Frenzied
/// family) both match opponents of the derived running style; `All`, and the
/// position-relative `AheadOfSelf`/`BehindSelf`. Other selectors (`InFov`,
/// `UmaId`, `UsedRecovery`, `AheadOfPosition`, `KakariAhead`/`KakariBehind`, ally
/// targets) are not yet routed from a live cast — manual debuff injection remains
/// their path.
pub fn resolve_debuff_targets(
    snapshot: &FieldSnapshot,
    source_id: RunnerId,
    target: SkillTarget,
    target_strategy: Option<Strategy>,
) -> Vec<RunnerId> {
    let source_pos = snapshot
        .entries
        .iter()
        .find(|e| e.id == source_id)
        .map(|e| e.position);
    snapshot
        .entries
        .iter()
        .filter(|e| e.id != source_id)
        .filter(|e| match target {
            SkillTarget::EnemyStrategy | SkillTarget::KakariStrategy => {
                target_strategy.is_some_and(|s| strategy_matches(e.strategy, s))
            }
            SkillTarget::All => true,
            SkillTarget::AheadOfSelf => source_pos.is_some_and(|p| e.position > p),
            SkillTarget::BehindSelf => source_pos.is_some_and(|p| e.position < p),
            _ => false,
        })
        .map(|e| e.id)
        .collect()
}

/// The closest runner matching the engine's front-block approximation.
///
/// The current lane-drift behavior also treats this as side-blocked. Keeping
/// that boolean derived from this result preserves the existing simulation.
pub fn front_blocking_runner(
    runner: &Runner,
    snapshots: &[RunnerSnapshot],
    horse_lane: f64,
) -> Option<RunnerId> {
    snapshots
        .iter()
        .filter(|snapshot| snapshot.id != runner.id)
        .filter(|snapshot| {
            let lane_delta = (snapshot.current_lane - runner.current_lane).abs();
            let distance_ahead = snapshot.position - runner.position;
            lane_delta <= horse_lane && distance_ahead > 0.0 && distance_ahead <= 5.0
        })
        .min_by(|a, b| (a.position - runner.position).total_cmp(&(b.position - runner.position)))
        .map(|snapshot| snapshot.id)
}

/// Whether the lane-drift approximation considers this runner blocked.
pub fn has_side_blocking_runner(
    runner: &Runner,
    snapshots: &[RunnerSnapshot],
    horse_lane: f64,
) -> bool {
    front_blocking_runner(runner, snapshots, horse_lane).is_some()
}

/// Whether `runner` is overtaking another runner (pushes the target lane out).
/// A contested-field producer reads this from the live proximity snapshot.
pub fn is_overtaking_runner(
    runner: &Runner,
    snapshots: &[RunnerSnapshot],
    horse_lane: f64,
) -> bool {
    let lane_threshold = horse_lane * 2.0;
    snapshots.iter().any(|snapshot| {
        if snapshot.id == runner.id {
            return false;
        }
        let is_faster = runner.current_speed > snapshot.current_speed;
        let distance_gap = (snapshot.position - runner.position).abs();
        let lane_delta = (snapshot.current_lane - runner.current_lane).abs();
        is_faster && distance_gap <= 5.0 && lane_delta <= lane_threshold
    })
}

/// Read an approximate-condition value, falling back to its start value when
/// not yet ticked. A synthetic-field producer reads side-block / overtake from
/// these instead of a live field.
pub fn condition_value(runner: &Runner, name: &str) -> i32 {
    if let Some(value) = runner.condition_values.get(name) {
        return *value;
    }
    runner
        .conditions
        .get(name)
        .map_or(0, |condition| condition.value_on_start())
}

/// Assign one gate per runner for a round.
///
/// A runner with a fixed gate keeps it. The remaining gates are dealt to the
/// remaining runners by a Fisher-Yates shuffle over `rng`, so an all-free field
/// consumes exactly the draws it always did and a fully pinned field consumes
/// none. `gate_count` may exceed the field (the vacuum engine always deals
/// from nine); a fixed gate outside `0..gate_count` or claimed twice is a
/// caller bug and is honored as given.
pub fn assign_gates(fixed: &[Option<i64>], gate_count: usize, rng: &mut dyn Prng) -> Vec<i64> {
    let mut free_gates: Vec<i64> = (0..gate_count as i64)
        .filter(|gate| !fixed.contains(&Some(*gate)))
        .collect();
    for i in (1..free_gates.len()).rev() {
        let j = rng.uniform(i as u32 + 1) as usize;
        free_gates.swap(i, j);
    }
    let mut free_gates = free_gates.into_iter();
    fixed
        .iter()
        .map(|slot| slot.or_else(|| free_gates.next()).unwrap_or(0))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn entry(id: u32, position: f64, strategy: Strategy) -> SnapEntry {
        SnapEntry {
            id: RunnerId(id),
            position,
            current_lane: 0.0,
            current_speed: 20.0,
            strategy,
            gate: 0,
            is_rushed: false,
            is_dueling: false,
            activated_advantage_effect_types: 0,
        }
    }

    fn snapshot(entries: Vec<SnapEntry>) -> FieldSnapshot {
        FieldSnapshot {
            num_total: entries.len() as i64,
            num_active: entries.len() as i64,
            entries,
            order: HashMap::new(),
            previous_order: HashMap::new(),
            pacer: None,
            pacer_position: None,
            pacer_strategy: None,
            second_place_position: None,
            leader_position: None,
        }
    }

    fn ids(mut v: Vec<RunnerId>) -> Vec<RunnerId> {
        v.sort_by_key(|r| r.0);
        v
    }

    #[test]
    fn enemy_strategy_targets_matching_others_only() {
        // R0 = caster (Late Surger), R1/R2 front runners, R3 pace chaser.
        let snap = snapshot(vec![
            entry(0, 100.0, Strategy::LateSurger),
            entry(1, 120.0, Strategy::FrontRunner),
            entry(2, 80.0, Strategy::Runaway), // Runaway counts as nige (front)
            entry(3, 90.0, Strategy::PaceChaser),
        ]);
        let got = resolve_debuff_targets(
            &snap,
            RunnerId(0),
            SkillTarget::EnemyStrategy,
            Some(Strategy::FrontRunner),
        );
        assert_eq!(ids(got), vec![RunnerId(1), RunnerId(2)]);
    }

    #[test]
    fn enemy_strategy_excludes_self_even_if_same_style() {
        // A front runner casting a nige-targeting debuff hits the *other* front
        // runner, never itself.
        let snap = snapshot(vec![
            entry(0, 100.0, Strategy::FrontRunner),
            entry(1, 120.0, Strategy::FrontRunner),
            entry(2, 90.0, Strategy::PaceChaser),
        ]);
        let got = resolve_debuff_targets(
            &snap,
            RunnerId(0),
            SkillTarget::EnemyStrategy,
            Some(Strategy::FrontRunner),
        );
        assert_eq!(got, vec![RunnerId(1)]);
    }

    #[test]
    fn enemy_strategy_without_derived_strategy_hits_nobody() {
        let snap = snapshot(vec![
            entry(0, 100.0, Strategy::LateSurger),
            entry(1, 120.0, Strategy::FrontRunner),
        ]);
        let got = resolve_debuff_targets(&snap, RunnerId(0), SkillTarget::EnemyStrategy, None);
        assert!(got.is_empty());
    }

    #[test]
    fn all_and_position_relative_targets() {
        let snap = snapshot(vec![
            entry(0, 100.0, Strategy::PaceChaser),  // caster
            entry(1, 120.0, Strategy::FrontRunner), // ahead
            entry(2, 80.0, Strategy::LateSurger),   // behind
        ]);
        assert_eq!(
            ids(resolve_debuff_targets(
                &snap,
                RunnerId(0),
                SkillTarget::All,
                None
            )),
            vec![RunnerId(1), RunnerId(2)]
        );
        assert_eq!(
            resolve_debuff_targets(&snap, RunnerId(0), SkillTarget::AheadOfSelf, None),
            vec![RunnerId(1)]
        );
        assert_eq!(
            resolve_debuff_targets(&snap, RunnerId(0), SkillTarget::BehindSelf, None),
            vec![RunnerId(2)]
        );
    }

    #[test]
    fn assign_gates_keeps_fixed_gates_and_deals_the_rest() {
        use crate::shared_kernel::rng::Xoshiro256StarStar;
        let fixed = [None, Some(0), None, Some(2)];
        let mut rng = Xoshiro256StarStar::from_u64_seed(1);
        let gates = assign_gates(&fixed, 4, &mut rng);
        assert_eq!(gates[1], 0);
        assert_eq!(gates[3], 2);
        let mut free = vec![gates[0], gates[2]];
        free.sort_unstable();
        assert_eq!(free, vec![1, 3]);
    }

    #[test]
    fn assign_gates_without_fixed_gates_is_a_permutation() {
        use crate::shared_kernel::rng::Xoshiro256StarStar;
        let mut rng = Xoshiro256StarStar::from_u64_seed(7);
        let mut gates = assign_gates(&[None; 9], 9, &mut rng);
        gates.sort_unstable();
        assert_eq!(gates, (0..9).collect::<Vec<i64>>());
    }
}
