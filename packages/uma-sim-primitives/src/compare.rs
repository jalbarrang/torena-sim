//! Compare-grade read-model projection over the domain-event stream.
//!
//! [`CompareDataCollector`] implements the [`RaceObserver`] port and accumulates
//! rich per-runner telemetry as an engine emits lifecycle events. It is shared by
//! the vacuum and contested engines because it depends only on primitive event
//! views plus projection helpers, not on either aggregate implementation.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;

use crate::events::{RaceObservation, RaceObserver, RunnerObservation};
// Projection primitives (effect-log reconciliation + value objects) live in
// `uma-sim-primitives` (ADR-0005 step 4). Re-exported below so existing
// `application::collectors::{SkillEffectLog, EffectPerspective}` paths (and the
// WASM DTO layer) keep resolving.
use crate::projection::{close_all, count_effects, reconcile_effects, OpenLogRef};
pub use crate::projection::{EffectPerspective, SkillEffectLog};
use crate::shared_kernel::ids::RunnerId;

/// Duration-based effect types (tracked as position ranges, not point events).
const ACTIVE_EFFECT_TYPES: [i32; 6] = [21, 22, 27, 28, 31, 35];

/// Rich per-runner, per-round data (port of TS `CollectedRunnerRoundData`).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CompareRoundData {
    /// Runner id.
    pub runner_id: u32,
    /// Per-tick elapsed time.
    pub time: Vec<f64>,
    /// Per-tick position.
    pub position: Vec<f64>,
    /// Per-tick true velocity (speed + current-speed modifier).
    pub velocity: Vec<f64>,
    /// Per-tick HP.
    pub hp: Vec<f64>,
    /// Per-tick lane.
    pub current_lane: Vec<f64>,
    /// Per-tick gap to the pacer.
    pub pacer_gap: Vec<f64>,
    /// Per-tick race order (1-based rank; 0 when the engine does not track it).
    pub order: Vec<i64>,
    /// Self-cast skill-effect activation logs, keyed by skill id.
    pub skill_activations: HashMap<String, Vec<SkillEffectLog>>,
    /// Externally-targeted skill-effect activation logs, keyed by skill id.
    pub targeted_skill_activations: HashMap<String, Vec<SkillEffectLog>>,
    /// Start delay in seconds.
    pub start_delay: f64,
    /// Closed rushed regions.
    pub rushed: Vec<(f64, f64)>,
    /// Dueling region, if any.
    pub dueling_region: Option<(f64, f64)>,
    /// Spot-struggle region, if any.
    pub spot_struggle_region: Option<(f64, f64)>,
    /// Fully Charged release region, if any.
    pub fully_charged_region: Option<(f64, f64)>,
    /// Fully Charged release acceleration bonus, if any.
    pub fully_charged_accel: Option<f64>,
    /// Whether a full last spurt was achieved.
    pub has_achieved_full_spurt: bool,
    /// Whether HP ran out.
    pub out_of_hp: bool,
    /// Distance-remaining when HP ran out.
    pub out_of_hp_position: Option<f64>,
    /// Velocity shortfall when the last spurt was not full.
    pub non_full_spurt_velocity_diff: Option<f64>,
    /// Delay distance when the last spurt was not full.
    pub non_full_spurt_delay_distance: Option<f64>,
    /// Whether the runner held first entering late race.
    pub first_position_in_late_race: bool,
    /// Ids of skills used this round (in activation order).
    pub used_skills: Vec<String>,
    /// Whether the runner finished.
    pub finished: bool,
    /// Final position.
    pub finish_position: f64,
}

/// Accumulated compare data: one map per round (runner id -> round data).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CompareData {
    /// Per-round runner data, plus the primary (first-seen) runner id per round.
    pub rounds: Vec<CompareRound>,
}

/// One round's compare data.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CompareRound {
    /// Master seed.
    pub seed: u64,
    /// The primary (first-added) runner's id, if any.
    pub primary_runner_id: Option<u32>,
    /// Per-runner round data.
    pub runners: Vec<CompareRoundData>,
}

/// An open effect log location: `(skill_id, index into that skill's log vec)`.

#[derive(Default)]
struct CompareRunnerState {
    data: CompareRoundData,
    open_effects: HashMap<String, Vec<OpenLogRef>>,
    open_targeted: HashMap<String, Vec<OpenLogRef>>,
    effect_sequence: u64,
    seen_used_skills: HashSet<String>,
    seen_targeted_count: usize,
}

#[derive(Default)]
struct CompareInner {
    seed: u64,
    primary: Option<u32>,
    states: Vec<(u32, CompareRunnerState)>,
    rounds: Vec<CompareRound>,
}

impl CompareInner {
    fn state_mut(&mut self, id: u32) -> &mut CompareRunnerState {
        if let Some(pos) = self.states.iter().position(|(rid, _)| *rid == id) {
            return &mut self.states[pos].1;
        }
        if self.primary.is_none() {
            self.primary = Some(id);
        }
        let mut state = CompareRunnerState::default();
        state.data.runner_id = id;
        self.states.push((id, state));
        let last = self.states.len() - 1;
        &mut self.states[last].1
    }
}

/// Read-model that produces rich per-runner round data for the compare family
/// (port of TS `VacuumCompareDataCollector`). The first runner seen each round
/// is the "primary" runner the compare orchestration diffs.
pub struct CompareDataCollector {
    inner: Rc<RefCell<CompareInner>>,
    focus_runner_ids: Option<HashSet<u32>>,
}

impl Default for CompareDataCollector {
    fn default() -> Self {
        Self::new()
    }
}

impl CompareDataCollector {
    /// A fresh compare collector.
    pub fn new() -> Self {
        CompareDataCollector {
            inner: Rc::new(RefCell::new(CompareInner::default())),
            focus_runner_ids: None,
        }
    }

    /// A fresh compare collector that only records the given runner ids.
    pub fn for_runner_ids(runner_ids: impl IntoIterator<Item = RunnerId>) -> Self {
        CompareDataCollector {
            inner: Rc::new(RefCell::new(CompareInner::default())),
            focus_runner_ids: Some(runner_ids.into_iter().map(|id| id.0).collect()),
        }
    }

    /// A boxed observer sharing this collector's storage.
    pub fn handle(&self) -> Box<dyn RaceObserver> {
        Box::new(CompareObserver {
            inner: Rc::clone(&self.inner),
            focus_runner_ids: self.focus_runner_ids.clone(),
        })
    }

    /// The accumulated per-round compare data.
    pub fn result(&self) -> CompareData {
        CompareData {
            rounds: self.inner.borrow().rounds.clone(),
        }
    }
}

struct CompareObserver {
    inner: Rc<RefCell<CompareInner>>,
    focus_runner_ids: Option<HashSet<u32>>,
}

impl CompareObserver {
    fn observes_runner(&self, id: u32) -> bool {
        self.focus_runner_ids
            .as_ref()
            .is_none_or(|focus| focus.contains(&id))
    }
}

impl RaceObserver for CompareObserver {
    fn on_round_start(&mut self, _race: &dyn RaceObservation, seed: u64) {
        let mut inner = self.inner.borrow_mut();
        inner.seed = seed;
        inner.primary = None;
        inner.states.clear();
    }

    fn on_after_runner_tick(
        &mut self,
        race: &dyn RaceObservation,
        runner: &dyn RunnerObservation,
        _dt: f64,
    ) {
        let seed = self.inner.borrow().seed;
        let id = runner.id().0;
        if !self.observes_runner(id) {
            return;
        }
        let distance = race.course_distance();
        let position = runner.position().min(distance);
        let pacer_gap = race.pacer_position().map_or(0.0, |p| p - runner.position());

        let active = runner.active_effects();
        let targeted = runner.targeted_active_effects();
        let used = runner.used_skills();
        let used_targeted = runner.used_targeted_skills();
        let static_effects = runner.skill_static_effects();

        let mut inner = self.inner.borrow_mut();
        let state = inner.state_mut(id);

        // --- per-tick frame ---
        if state.data.start_delay == 0.0 {
            state.data.start_delay = runner.start_delay();
        }
        state.data.time.push(runner.accumulate_time());
        state.data.position.push(runner.position());
        state
            .data
            .velocity
            .push(runner.current_speed() + runner.current_speed_modifier());
        state.data.hp.push(runner.current_health());
        state.data.current_lane.push(runner.current_lane());
        state.data.pacer_gap.push(pacer_gap);
        state
            .data
            .order
            .push(race.runner_order(runner.id()).unwrap_or(0));

        // --- duration-effect reconcile (self + targeted) ---
        let self_counts = count_effects(&active);
        reconcile_effects(
            &self_counts,
            &mut state.open_effects,
            &mut state.data.skill_activations,
            EffectPerspective::SelfCast,
            position,
            seed,
            id,
            &mut state.effect_sequence,
        );
        let targeted_counts = count_effects(&targeted);
        reconcile_effects(
            &targeted_counts,
            &mut state.open_targeted,
            &mut state.data.targeted_skill_activations,
            EffectPerspective::Other,
            position,
            seed,
            id,
            &mut state.effect_sequence,
        );

        // --- newly used skills: log their instant (static) effects ---
        for used_skill_id in &used {
            if state.seen_used_skills.contains(*used_skill_id) {
                continue;
            }
            state.seen_used_skills.insert((*used_skill_id).to_owned());
            state.data.used_skills.push((*used_skill_id).to_owned());
            let mut new_logs: Vec<SkillEffectLog> = Vec::new();
            for effect in &static_effects {
                if effect.skill_id != *used_skill_id
                    || ACTIVE_EFFECT_TYPES.contains(&effect.effect_type)
                {
                    continue;
                }
                new_logs.push(SkillEffectLog {
                    execution_id: format!("{seed}-{id}-{}", state.effect_sequence),
                    skill_id: (*used_skill_id).to_owned(),
                    start: position,
                    end: position,
                    perspective: EffectPerspective::SelfCast,
                    effect_type: effect.effect_type,
                    effect_target: effect.effect_target,
                });
                state.effect_sequence += 1;
            }
            if !new_logs.is_empty() {
                state
                    .data
                    .skill_activations
                    .entry((*used_skill_id).to_owned())
                    .or_default()
                    .extend(new_logs);
            }
        }

        // --- newly used targeted skills: log instant ones as point events ---
        for entry in &used_targeted[state.seen_targeted_count..] {
            if ACTIVE_EFFECT_TYPES.contains(&entry.effect_type) {
                continue;
            }
            let pos = entry.position.min(distance);
            let logs = state
                .data
                .targeted_skill_activations
                .entry(entry.skill_id.clone())
                .or_default();
            logs.push(SkillEffectLog {
                execution_id: format!("{seed}-{id}-{}", state.effect_sequence),
                skill_id: entry.skill_id.clone(),
                start: pos,
                end: pos,
                perspective: EffectPerspective::Other,
                effect_type: entry.effect_type,
                effect_target: entry.effect_target,
            });
            state.effect_sequence += 1;
        }
        state.seen_targeted_count = used_targeted.len();
    }

    fn on_runner_finished(&mut self, race: &dyn RaceObservation, runner: &dyn RunnerObservation) {
        let distance = race.course_distance();
        let position = runner.position().min(distance);
        let mut inner = self.inner.borrow_mut();
        let id = runner.id().0;
        if !self.observes_runner(id) {
            return;
        }
        let state = inner.state_mut(id);
        close_all(
            &mut state.open_effects,
            &mut state.data.skill_activations,
            position,
        );
        close_all(
            &mut state.open_targeted,
            &mut state.data.targeted_skill_activations,
            position,
        );
        let d = &mut state.data;
        d.start_delay = runner.start_delay();
        d.rushed = runner.rushed_activations();
        let duel_start = runner.dueling_start_position();
        d.dueling_region = if duel_start >= 0.0 {
            let end = runner.dueling_end_position();
            Some((duel_start, if end >= 0.0 { end } else { distance }))
        } else {
            None
        };
        d.spot_struggle_region = runner.spot_struggle_start_position().map(|start| {
            let end = runner.spot_struggle_end_position();
            (start, if end >= 0.0 { end } else { distance })
        });
        d.fully_charged_region = runner
            .fully_charged_region()
            .map(|(start, end)| (start, if end >= 0.0 { end } else { distance }));
        d.fully_charged_accel = runner.fully_charged_accel();
        d.has_achieved_full_spurt = runner.has_achieved_full_spurt();
        d.out_of_hp = runner.out_of_hp();
        d.out_of_hp_position = runner.out_of_hp_position();
        d.non_full_spurt_velocity_diff = runner.non_full_spurt_velocity_diff();
        d.non_full_spurt_delay_distance = runner.non_full_spurt_delay_distance();
        d.first_position_in_late_race = runner.first_position_in_late_race();
        d.finished = true;
        d.finish_position = position;
    }

    fn on_round_end(&mut self, race: &dyn RaceObservation) {
        let distance = race.course_distance();
        let mut inner = self.inner.borrow_mut();
        // Close any still-open effects for non-finishers.
        for (_, state) in &mut inner.states {
            if !state.data.finished {
                close_all(
                    &mut state.open_effects,
                    &mut state.data.skill_activations,
                    distance,
                );
                close_all(
                    &mut state.open_targeted,
                    &mut state.data.targeted_skill_activations,
                    distance,
                );
            }
        }
        let primary = inner.primary;
        let seed = inner.seed;
        let runners: Vec<CompareRoundData> =
            inner.states.iter().map(|(_, s)| s.data.clone()).collect();
        inner.rounds.push(CompareRound {
            seed,
            primary_runner_id: primary,
            runners,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::ActiveEffectView;
    use crate::shared_kernel::ids::RunnerId;

    struct DummyRace;
    impl RaceObservation for DummyRace {
        fn seed(&self) -> u64 {
            7
        }
    }

    #[derive(Default)]
    struct CmpRunner {
        id: u32,
        pos: f64,
        speed: f64,
        health: f64,
        active: Vec<ActiveEffectView>,
        used: Vec<String>,
        statics: Vec<crate::events::StaticEffectView>,
        rushed: Vec<(f64, f64)>,
        fully_charged_region: Option<(f64, f64)>,
        fully_charged_accel: Option<f64>,
        full_spurt: bool,
    }
    impl RunnerObservation for CmpRunner {
        fn id(&self) -> RunnerId {
            RunnerId(self.id)
        }
        fn position(&self) -> f64 {
            self.pos
        }
        fn current_speed(&self) -> f64 {
            self.speed
        }
        fn current_health(&self) -> f64 {
            self.health
        }
        fn active_effects(&self) -> Vec<ActiveEffectView> {
            self.active.clone()
        }
        fn used_skills(&self) -> Vec<&str> {
            self.used.iter().map(String::as_str).collect()
        }
        fn skill_static_effects(&self) -> Vec<crate::events::StaticEffectView> {
            self.statics.clone()
        }
        fn rushed_activations(&self) -> Vec<(f64, f64)> {
            self.rushed.clone()
        }
        fn fully_charged_region(&self) -> Option<(f64, f64)> {
            self.fully_charged_region
        }
        fn fully_charged_accel(&self) -> Option<f64> {
            self.fully_charged_accel
        }
        fn has_achieved_full_spurt(&self) -> bool {
            self.full_spurt
        }
    }

    struct CmpRace;
    impl RaceObservation for CmpRace {
        fn course_distance(&self) -> f64 {
            2400.0
        }
    }

    #[test]
    fn compare_collector_captures_round_and_effect_ranges() {
        let collector = CompareDataCollector::new();
        let mut obs = collector.handle();
        obs.on_round_start(&CmpRace, 7);

        let ts_effect = ActiveEffectView {
            skill_id: "100001".to_owned(),
            effect_type: 27, // TargetSpeed (active)
            effect_target: 0,
            modifier: 0.3,
        };
        // Tick 1: effect active at 100m.
        obs.on_after_runner_tick(
            &CmpRace,
            &CmpRunner {
                id: 3,
                pos: 100.0,
                speed: 18.0,
                health: 900.0,
                active: vec![ts_effect],
                used: vec!["100001".to_owned()],
                ..Default::default()
            },
            0.066,
        );
        // Tick 2: effect ended at 120m (not in active list).
        obs.on_after_runner_tick(
            &CmpRace,
            &CmpRunner {
                id: 3,
                pos: 120.0,
                speed: 18.5,
                health: 880.0,
                ..Default::default()
            },
            0.066,
        );
        obs.on_runner_finished(
            &CmpRace,
            &CmpRunner {
                id: 3,
                pos: 2400.0,
                rushed: vec![(300.0, 360.0)],
                fully_charged_region: Some((1800.0, 1860.0)),
                fully_charged_accel: Some(0.15),
                full_spurt: true,
                ..Default::default()
            },
        );
        obs.on_round_end(&DummyRace);

        let data = collector.result();
        assert_eq!(data.rounds.len(), 1);
        let round = &data.rounds[0];
        assert_eq!(round.seed, 7);
        assert_eq!(round.primary_runner_id, Some(3));
        let runner = &round.runners[0];
        assert_eq!(runner.position, vec![100.0, 120.0]);
        // The active TargetSpeed effect was opened at 100 and closed at 120.
        let logs = runner
            .skill_activations
            .get("100001")
            .expect("activation logs");
        let active_log = logs
            .iter()
            .find(|l| l.effect_type == 27)
            .expect("target-speed log");
        assert_eq!(active_log.start, 100.0);
        assert_eq!(active_log.end, 120.0);
        // Finish snapshot.
        assert!(runner.finished);
        assert_eq!(runner.finish_position, 2400.0);
        assert_eq!(runner.rushed, vec![(300.0, 360.0)]);
        assert_eq!(runner.fully_charged_region, Some((1800.0, 1860.0)));
        assert_eq!(runner.fully_charged_accel, Some(0.15));
        assert!(runner.has_achieved_full_spurt);
    }
}
