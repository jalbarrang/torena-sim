//! Compare-grade read-model projection over the domain-event stream.
//!
//! `CompareDataCollector` implements the `RaceObserver` port and accumulates
//! rich per-runner telemetry as an engine emits lifecycle events. It is shared by
//! the vacuum and contested engines because it depends only on primitive event
//! views plus projection helpers, not on either aggregate implementation.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;

use crate::events::{RaceObservation, RaceObserver, RunnerObservation};
use crate::stamina::ledger::StaminaLedger;
// Projection primitives (effect-log reconciliation + value objects) live in
// the shared primitives module (ADR-0005 step 4). Re-exported below so existing
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
    /// Position-keep regions as `(start, end, state)`, where `state` is the
    /// `PositionKeepState` discriminant (1 pace up, 2 pace down, 3 speed up,
    /// 4 overtake, 5 pace up ex). Every region the collector records is closed:
    /// one still open at the finish is closed to the course distance.
    pub position_keep_regions: Vec<(f64, f64, i64)>,
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
    /// Where this runner's HP went, when the stamina policy records it.
    /// `None` means the policy does not model HP, not that nothing happened.
    pub stamina_ledger: Option<StaminaLedger>,
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

/// Two independently-raced compare runs, paired by round index.
///
/// The vacuum compare can race each contestant in its own field; a paired-delta
/// reader still diffs them round by round, so the two read-models travel
/// together rather than as two calls whose alignment a caller has to trust.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct PairedCompareData {
    /// The first contestant's rounds.
    pub first: CompareData,
    /// The second contestant's rounds.
    pub second: CompareData,
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

/// Position-only per-runner, per-round data.
///
/// The skill planner's bashin delta reads only the position series, so its
/// collector records nothing else: no velocity/HP/lane arrays and no effect
/// reconciliation. Frames match [`CompareRoundData::position`] exactly.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct PositionRoundData {
    /// Runner id.
    pub runner_id: u32,
    /// Per-tick position.
    pub position: Vec<f64>,
}

/// One round's position-only data.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct PositionRound {
    /// Master seed.
    pub seed: u64,
    /// The primary (first-seen) runner's id, if any.
    pub primary_runner_id: Option<u32>,
    /// Per-runner position series.
    pub runners: Vec<PositionRoundData>,
}

/// Accumulated position-only data: one entry per round.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct PositionData {
    /// Per-round runner position series.
    pub rounds: Vec<PositionRound>,
}

/// An open effect log location: `(skill_id, index into that skill's log vec)`.

#[derive(Default)]
struct CompareRunnerState {
    data: CompareRoundData,
    open_effects: HashMap<String, Vec<OpenLogRef>>,
    open_targeted: HashMap<String, Vec<OpenLogRef>>,
    effect_sequence: u64,
    seen_used_skills: HashMap<String, usize>,
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
        // `used` lists every activation in order, so a cooldown skill's second
        // proc appears again. Walk that list directly to preserve activation
        // order while comparing per-id occurrence counts against the ledger.
        let mut occurrences: HashMap<&str, usize> = HashMap::new();
        for used_skill_id in &used {
            let occurrence = {
                let count = occurrences.entry(*used_skill_id).or_insert(0);
                *count += 1;
                *count
            };
            let seen = state
                .seen_used_skills
                .get(*used_skill_id)
                .copied()
                .unwrap_or(0);
            if occurrence <= seen {
                continue;
            }
            state
                .seen_used_skills
                .insert((*used_skill_id).to_owned(), occurrence);
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
        // Region ends recorded on the finish-crossing frame can overshoot the
        // course distance (positions advance ~1.4m per frame); clamp every
        // region channel to the track so read-models never extend past it.
        d.rushed = runner
            .rushed_activations()
            .into_iter()
            .map(|(s, e)| (s.min(distance), e.min(distance)))
            .collect();
        // A position-keep region is back-filled with its exit position, so one
        // still open when the runner crosses the line carries `end == 0.0`.
        // Close it to the finish rather than dropping it: the runner really was
        // pacing up or down over that last stretch.
        d.position_keep_regions = runner
            .position_keep_activations()
            .into_iter()
            .map(|(s, e, state)| {
                let end = if e > 0.0 { e } else { distance };
                (s.min(distance), end.min(distance), state)
            })
            .collect();
        let duel_start = runner.dueling_start_position();
        d.dueling_region = if duel_start >= 0.0 {
            let end = runner.dueling_end_position();
            let end = if end >= 0.0 { end } else { distance };
            Some((duel_start.min(distance), end.min(distance)))
        } else {
            None
        };
        d.spot_struggle_region = runner.spot_struggle_start_position().map(|start| {
            let end = runner.spot_struggle_end_position();
            let end = if end >= 0.0 { end } else { distance };
            (start.min(distance), end.min(distance))
        });
        d.fully_charged_region = runner.fully_charged_region().map(|(start, end)| {
            let end = if end >= 0.0 { end } else { distance };
            (start.min(distance), end.min(distance))
        });
        d.fully_charged_accel = runner.fully_charged_accel();
        d.has_achieved_full_spurt = runner.has_achieved_full_spurt();
        d.out_of_hp = runner.out_of_hp();
        d.out_of_hp_position = runner.out_of_hp_position();
        d.non_full_spurt_velocity_diff = runner.non_full_spurt_velocity_diff();
        d.non_full_spurt_delay_distance = runner.non_full_spurt_delay_distance();
        d.first_position_in_late_race = runner.first_position_in_late_race();
        d.stamina_ledger = runner.stamina_ledger();
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

#[derive(Default)]
struct PositionInner {
    seed: u64,
    primary: Option<u32>,
    states: Vec<(u32, PositionRoundData)>,
    rounds: Vec<PositionRound>,
}

impl PositionInner {
    fn state_mut(&mut self, id: u32) -> &mut PositionRoundData {
        if let Some(pos) = self.states.iter().position(|(rid, _)| *rid == id) {
            return &mut self.states[pos].1;
        }
        if self.primary.is_none() {
            self.primary = Some(id);
        }
        let data = PositionRoundData {
            runner_id: id,
            position: Vec::new(),
        };
        self.states.push((id, data));
        let last = self.states.len() - 1;
        &mut self.states[last].1
    }
}

/// Read-model that records only per-tick positions.
///
/// The skill planner diffs finish-time positions against a baseline and never
/// reads velocity, HP, lane, order, or effect logs. Recording just positions
/// keeps the per-tick work and the serialized payload to what the planner uses.
pub struct PositionDataCollector {
    inner: Rc<RefCell<PositionInner>>,
    focus_runner_ids: Option<HashSet<u32>>,
}

impl Default for PositionDataCollector {
    fn default() -> Self {
        Self::new()
    }
}

impl PositionDataCollector {
    /// A fresh position collector.
    pub fn new() -> Self {
        PositionDataCollector {
            inner: Rc::new(RefCell::new(PositionInner::default())),
            focus_runner_ids: None,
        }
    }

    /// A fresh position collector that only records the given runner ids.
    pub fn for_runner_ids(runner_ids: impl IntoIterator<Item = RunnerId>) -> Self {
        PositionDataCollector {
            inner: Rc::new(RefCell::new(PositionInner::default())),
            focus_runner_ids: Some(runner_ids.into_iter().map(|id| id.0).collect()),
        }
    }

    /// A boxed observer sharing this collector's storage.
    pub fn handle(&self) -> Box<dyn RaceObserver> {
        Box::new(PositionObserver {
            inner: Rc::clone(&self.inner),
            focus_runner_ids: self.focus_runner_ids.clone(),
        })
    }

    /// The accumulated per-round position data.
    pub fn result(&self) -> PositionData {
        PositionData {
            rounds: self.inner.borrow().rounds.clone(),
        }
    }
}

struct PositionObserver {
    inner: Rc<RefCell<PositionInner>>,
    focus_runner_ids: Option<HashSet<u32>>,
}

impl PositionObserver {
    fn observes_runner(&self, id: u32) -> bool {
        self.focus_runner_ids
            .as_ref()
            .is_none_or(|focus| focus.contains(&id))
    }
}

impl RaceObserver for PositionObserver {
    fn on_round_start(&mut self, _race: &dyn RaceObservation, seed: u64) {
        let mut inner = self.inner.borrow_mut();
        inner.seed = seed;
        inner.primary = None;
        inner.states.clear();
    }

    fn on_after_runner_tick(
        &mut self,
        _race: &dyn RaceObservation,
        runner: &dyn RunnerObservation,
        _dt: f64,
    ) {
        let id = runner.id().0;
        if !self.observes_runner(id) {
            return;
        }
        let mut inner = self.inner.borrow_mut();
        inner.state_mut(id).position.push(runner.position());
    }

    fn on_round_end(&mut self, _race: &dyn RaceObservation) {
        let mut inner = self.inner.borrow_mut();
        let primary = inner.primary;
        let seed = inner.seed;
        let runners: Vec<PositionRoundData> =
            inner.states.iter().map(|(_, data)| data.clone()).collect();
        inner.rounds.push(PositionRound {
            seed,
            primary_runner_id: primary,
            runners,
        });
    }
}

/// Skill-compare (basin) per-runner, per-round data.
///
/// The basin reduction reads the position/velocity series, the tracked skill's
/// self-cast activation logs, and whether each skill was used. It never reads
/// HP, lane, pacer gap, order, targeted activations, or the mechanic regions the
/// full compare read-model carries, so this collector records only what it needs.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct BasinRoundData {
    /// Runner id.
    pub runner_id: u32,
    /// Per-tick elapsed time.
    pub time: Vec<f64>,
    /// Per-tick position.
    pub position: Vec<f64>,
    /// Per-tick true velocity (speed + current-speed modifier).
    pub velocity: Vec<f64>,
    /// Self-cast skill-effect activation logs, keyed by skill id.
    pub skill_activations: HashMap<String, Vec<SkillEffectLog>>,
    /// Ids of skills used this round (in activation order).
    pub used_skills: Vec<String>,
    /// Final position.
    pub finish_position: f64,
}

/// One round's basin data.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct BasinRound {
    /// Master seed.
    pub seed: u64,
    /// The primary (first-seen) runner's id, if any.
    pub primary_runner_id: Option<u32>,
    /// Per-runner round data.
    pub runners: Vec<BasinRoundData>,
}

/// Accumulated basin data: one entry per round.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct BasinData {
    /// Per-round runner data.
    pub rounds: Vec<BasinRound>,
}

#[derive(Default)]
struct BasinRunnerState {
    data: BasinRoundData,
    open_effects: HashMap<String, Vec<OpenLogRef>>,
    effect_sequence: u64,
    seen_used_skills: HashMap<String, usize>,
    finished: bool,
}

#[derive(Default)]
struct BasinInner {
    seed: u64,
    primary: Option<u32>,
    states: Vec<(u32, BasinRunnerState)>,
    rounds: Vec<BasinRound>,
}

impl BasinInner {
    fn state_mut(&mut self, id: u32) -> &mut BasinRunnerState {
        if let Some(pos) = self.states.iter().position(|(rid, _)| *rid == id) {
            return &mut self.states[pos].1;
        }
        if self.primary.is_none() {
            self.primary = Some(id);
        }
        let mut state = BasinRunnerState::default();
        state.data.runner_id = id;
        self.states.push((id, state));
        let last = self.states.len() - 1;
        &mut self.states[last].1
    }
}

/// Read-model that records only the channels the skill/unique basin reduces.
pub struct BasinDataCollector {
    inner: Rc<RefCell<BasinInner>>,
    focus_runner_ids: Option<HashSet<u32>>,
}

impl Default for BasinDataCollector {
    fn default() -> Self {
        Self::new()
    }
}

impl BasinDataCollector {
    /// A fresh basin collector.
    pub fn new() -> Self {
        BasinDataCollector {
            inner: Rc::new(RefCell::new(BasinInner::default())),
            focus_runner_ids: None,
        }
    }

    /// A fresh basin collector that only records the given runner ids.
    pub fn for_runner_ids(runner_ids: impl IntoIterator<Item = RunnerId>) -> Self {
        BasinDataCollector {
            inner: Rc::new(RefCell::new(BasinInner::default())),
            focus_runner_ids: Some(runner_ids.into_iter().map(|id| id.0).collect()),
        }
    }

    /// A boxed observer sharing this collector's storage.
    pub fn handle(&self) -> Box<dyn RaceObserver> {
        Box::new(BasinObserver {
            inner: Rc::clone(&self.inner),
            focus_runner_ids: self.focus_runner_ids.clone(),
        })
    }

    /// The accumulated per-round basin data.
    pub fn result(&self) -> BasinData {
        BasinData {
            rounds: self.inner.borrow().rounds.clone(),
        }
    }
}

struct BasinObserver {
    inner: Rc<RefCell<BasinInner>>,
    focus_runner_ids: Option<HashSet<u32>>,
}

impl BasinObserver {
    fn observes_runner(&self, id: u32) -> bool {
        self.focus_runner_ids
            .as_ref()
            .is_none_or(|focus| focus.contains(&id))
    }
}

impl RaceObserver for BasinObserver {
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

        let active = runner.active_effects();
        let used = runner.used_skills();
        let static_effects = runner.skill_static_effects();

        let mut inner = self.inner.borrow_mut();
        let state = inner.state_mut(id);

        state.data.time.push(runner.accumulate_time());
        state.data.position.push(runner.position());
        state
            .data
            .velocity
            .push(runner.current_speed() + runner.current_speed_modifier());

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

        // Newly used skills: log their instant (static) effects. `used` lists
        // every activation in order, so a cooldown skill's second proc appears
        // again; per-id occurrence counts against the ledger preserve order.
        let mut occurrences: HashMap<&str, usize> = HashMap::new();
        for used_skill_id in &used {
            let occurrence = {
                let count = occurrences.entry(*used_skill_id).or_insert(0);
                *count += 1;
                *count
            };
            let seen = state
                .seen_used_skills
                .get(*used_skill_id)
                .copied()
                .unwrap_or(0);
            if occurrence <= seen {
                continue;
            }
            state
                .seen_used_skills
                .insert((*used_skill_id).to_owned(), occurrence);
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
        state.finished = true;
        state.data.finish_position = position;
    }

    fn on_round_end(&mut self, race: &dyn RaceObservation) {
        let distance = race.course_distance();
        let mut inner = self.inner.borrow_mut();
        // Close any still-open effects for non-finishers.
        for (_, state) in &mut inner.states {
            if !state.finished {
                close_all(
                    &mut state.open_effects,
                    &mut state.data.skill_activations,
                    distance,
                );
            }
        }
        let primary = inner.primary;
        let seed = inner.seed;
        let runners: Vec<BasinRoundData> = inner
            .states
            .iter()
            .map(|(_, state)| state.data.clone())
            .collect();
        inner.rounds.push(BasinRound {
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
        position_keep: Vec<(f64, f64, i64)>,
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
        fn position_keep_activations(&self) -> Vec<(f64, f64, i64)> {
            self.position_keep.clone()
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
    fn compare_collector_preserves_repeated_skill_order() {
        let collector = CompareDataCollector::new();
        let mut obs = collector.handle();
        obs.on_round_start(&CmpRace, 7);

        obs.on_after_runner_tick(
            &CmpRace,
            &CmpRunner {
                id: 3,
                pos: 100.0,
                used: vec![
                    "201662".to_owned(),
                    "200331".to_owned(),
                    "201662".to_owned(),
                ],
                ..Default::default()
            },
            0.066,
        );
        obs.on_round_end(&CmpRace);

        assert_eq!(
            collector.result().rounds[0].runners[0].used_skills,
            vec![
                "201662".to_owned(),
                "200331".to_owned(),
                "201662".to_owned(),
            ]
        );
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

    /// A position-keep region is back-filled on state exit, so the one still
    /// open when the runner crosses the line arrives as `end == 0.0` and has to
    /// be closed to the finish. Clamping also has to hold: the finish-crossing
    /// frame overshoots the course distance.
    #[test]
    fn compare_collector_closes_and_clamps_position_keep_regions() {
        let collector = CompareDataCollector::new();
        let mut obs = collector.handle();
        obs.on_round_start(&CmpRace, 7);

        obs.on_runner_finished(
            &CmpRace,
            &CmpRunner {
                id: 3,
                pos: 2401.4,
                position_keep: vec![
                    // Pace up, exited normally.
                    (120.0, 300.0, 1),
                    // Pace down, still open at the finish.
                    (2200.0, 0.0, 2),
                    // Pace up ex, its exit overshot the track.
                    (2380.0, 2401.4, 5),
                ],
                ..Default::default()
            },
        );
        obs.on_round_end(&CmpRace);

        let runner = &collector.result().rounds[0].runners[0];
        assert_eq!(
            runner.position_keep_regions,
            vec![(120.0, 300.0, 1), (2200.0, 2400.0, 2), (2380.0, 2400.0, 5),]
        );
    }
}
