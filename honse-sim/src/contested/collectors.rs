//! Read-model **projections** over the domain-event stream.
//!
//! Collectors implement the [`RaceObserver`] port (t-012) and accumulate
//! telemetry as the aggregate emits lifecycle events. They are projections, not
//! domain logic — they live in the application layer and never mutate the race.
//!
//! [`RaceSimDataCollector`] captures per-round, per-tick traces for a set of
//! *focus* runners (used to drive charts / replays in the UI). The richer
//! state-diff event-log projection (`race-event-log.ts`) is a larger port and is
//! tracked as follow-up work.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;

use uma_sim_primitives::events::{RaceObservation, RaceObserver, RunnerObservation};
// Projection primitives (effect-log reconciliation + value objects) live in
// the shared primitives module (ADR-0005 step 4). Re-exported below so existing
// `application::collectors::{SkillEffectLog, EffectPerspective}` paths (and the
// WASM DTO layer) keep resolving.
use uma_sim_primitives::projection::{close_all, count_effects, reconcile_effects, OpenLogRef};
pub use uma_sim_primitives::projection::{EffectPerspective, SkillEffectLog};
use uma_sim_primitives::shared_kernel::ids::RunnerId;

/// Ticks per simulated second (15 FPS); matches the aggregate frame rate.
const TICKS_PER_SECOND: f64 = 15.0;
/// Duration-based effect types (tracked as position ranges, not point events).
const ACTIVE_EFFECT_TYPES: [i32; 6] = [21, 22, 27, 28, 31, 35];
/// Position-keep discriminants the event log watches (mirror `PositionKeepState`).
const PK_PACE_UP: i64 = 1;
const PK_PACE_DOWN: i64 = 2;
const PK_PACE_UP_EX: i64 = 5;

/// One per-tick sample of a focused runner.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TickSample {
    /// Elapsed race time in seconds.
    pub time: f64,
    /// Longitudinal position in meters.
    pub position: f64,
    /// Current speed in m/s.
    pub speed: f64,
    /// Lateral lane offset.
    pub lane: f64,
    /// Remaining absolute HP.
    pub health: f64,
}

/// The per-round trace for one focused runner.
#[derive(Debug, Clone, PartialEq)]
pub struct FocusTrace {
    /// The focused runner.
    pub runner_id: RunnerId,
    /// Per-tick samples in chronological order.
    pub samples: Vec<TickSample>,
    /// Self-cast skill-effect activation logs (`[start, end]` position ranges),
    /// keyed by skill id. Duration effects carry `end > start`; instant effects
    /// are point markers (`start == end`).
    pub skill_activations: HashMap<String, Vec<SkillEffectLog>>,
}

/// One round's collected focus traces.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RoundData {
    /// Master seed of the round.
    pub seed: u64,
    /// One trace per focused runner.
    pub focus: Vec<FocusTrace>,
}

/// The accumulated result of a [`RaceSimDataCollector`].
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CollectedData {
    /// One entry per simulated round.
    pub rounds: Vec<RoundData>,
}

/// Transient per-round, per-focus-runner effect-log reconciliation state.
#[derive(Default)]
struct FocusEffectState {
    open_effects: HashMap<String, Vec<OpenLogRef>>,
    effect_sequence: u64,
    seen_used_skills: HashSet<String>,
}

#[derive(Default)]
struct CollectorInner {
    focus_ids: Vec<RunnerId>,
    data: CollectedData,
    /// Open effect-log state for the current round, keyed by runner id.
    effect_state: HashMap<u32, FocusEffectState>,
}

/// Collects per-tick traces for a set of focus runners across rounds.
///
/// Construct it, attach [`handle`](Self::handle) as a [`RaceObserver`] on the
/// race, run the simulation, then read [`result`](Self::result).
pub struct RaceSimDataCollector {
    inner: Rc<RefCell<CollectorInner>>,
}

impl RaceSimDataCollector {
    /// A collector tracing the given focus runners (empty = trace none).
    pub fn new(focus_ids: Vec<RunnerId>) -> Self {
        RaceSimDataCollector {
            inner: Rc::new(RefCell::new(CollectorInner {
                focus_ids,
                data: CollectedData::default(),
                effect_state: HashMap::new(),
            })),
        }
    }

    /// A boxed observer sharing this collector's storage (subscribe it on the
    /// race).
    pub fn handle(&self) -> Box<dyn RaceObserver> {
        Box::new(CollectorObserver {
            inner: Rc::clone(&self.inner),
        })
    }

    /// Snapshot of the data collected so far.
    pub fn result(&self) -> CollectedData {
        self.inner.borrow().data.clone()
    }
}

struct CollectorObserver {
    inner: Rc<RefCell<CollectorInner>>,
}

impl RaceObserver for CollectorObserver {
    fn on_round_start(&mut self, race: &dyn RaceObservation, seed: u64) {
        let mut inner = self.inner.borrow_mut();
        let focus = inner
            .focus_ids
            .iter()
            .map(|&runner_id| FocusTrace {
                runner_id,
                samples: Vec::new(),
                skill_activations: HashMap::new(),
            })
            .collect();
        let _ = race;
        inner.effect_state.clear();
        inner.data.rounds.push(RoundData { seed, focus });
    }

    fn on_after_runner_tick(
        &mut self,
        race: &dyn RaceObservation,
        runner: &dyn RunnerObservation,
        _dt: f64,
    ) {
        let mut inner = self.inner.borrow_mut();
        if !inner.focus_ids.contains(&runner.id()) {
            return;
        }
        let id = runner.id().0;
        let distance = race.course_distance();
        let position = runner.position().min(distance);
        let seed = inner.data.rounds.last().map_or(0, |r| r.seed);
        let sample = TickSample {
            time: runner.accumulate_time(),
            position: runner.position(),
            speed: runner.current_speed(),
            lane: runner.current_lane(),
            health: runner.current_health(),
        };

        let active = runner.active_effects();
        let used = runner.used_skills();
        let static_effects = runner.skill_static_effects();

        let CollectorInner {
            data, effect_state, ..
        } = &mut *inner;
        let Some(round) = data.rounds.last_mut() else {
            return;
        };
        let Some(trace) = round.focus.iter_mut().find(|t| t.runner_id.0 == id) else {
            return;
        };
        trace.samples.push(sample);

        let state = effect_state.entry(id).or_default();

        // --- duration-effect reconcile (self-cast) ---
        let self_counts = count_effects(&active);
        reconcile_effects(
            &self_counts,
            &mut state.open_effects,
            &mut trace.skill_activations,
            EffectPerspective::SelfCast,
            position,
            seed,
            id,
            &mut state.effect_sequence,
        );

        // --- newly used skills: log their instant (static) effects as points ---
        for used_skill_id in &used {
            if state.seen_used_skills.contains(*used_skill_id) {
                continue;
            }
            state.seen_used_skills.insert((*used_skill_id).to_owned());
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
                trace
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
        let id = runner.id().0;
        let mut inner = self.inner.borrow_mut();
        if !inner.focus_ids.contains(&runner.id()) {
            return;
        }
        let CollectorInner {
            data, effect_state, ..
        } = &mut *inner;
        let Some(state) = effect_state.get_mut(&id) else {
            return;
        };
        if let Some(round) = data.rounds.last_mut() {
            if let Some(trace) = round.focus.iter_mut().find(|t| t.runner_id.0 == id) {
                close_all(
                    &mut state.open_effects,
                    &mut trace.skill_activations,
                    position,
                );
            }
        }
    }

    fn on_round_end(&mut self, race: &dyn RaceObservation) {
        let distance = race.course_distance();
        let mut inner = self.inner.borrow_mut();
        let CollectorInner {
            data, effect_state, ..
        } = &mut *inner;
        let Some(round) = data.rounds.last_mut() else {
            return;
        };
        // Close any still-open effects for runners that did not finish.
        for trace in &mut round.focus {
            if let Some(state) = effect_state.get_mut(&trace.runner_id.0) {
                close_all(
                    &mut state.open_effects,
                    &mut trace.skill_activations,
                    distance,
                );
            }
        }
    }
}

/// Kind of a logged race event (port of TS `RaceEventKind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RaceLogEventKind {
    /// A skill activated.
    SkillActivated,
    /// An opponent-facing debuff landed on this runner (cross-runner or
    /// injected). `detail.skill_id` is the debuff skill.
    Debuffed,
    /// Entered the rushed (temptation) state.
    Rushed,
    /// Left the rushed state.
    RushedEnd,
    /// Began dueling.
    DuelingStart,
    /// Stopped dueling.
    DuelingEnd,
    /// Entered a spot struggle.
    SpotStruggleStart,
    /// Left a spot struggle.
    SpotStruggleEnd,
    /// Began Fully Charged release.
    FullyCharged,
    /// Ended Fully Charged release.
    FullyChargedEnd,
    /// Entered last spurt.
    LastSpurt,
    /// Ran out of HP.
    HpOut,
    /// Crossed the finish line.
    Finished,
    /// Began pacing down.
    PaceDownStart,
    /// Stopped pacing down.
    PaceDownEnd,
    /// Began pacing up.
    PaceUpStart,
    /// Stopped pacing up.
    PaceUpEnd,
    /// Began extended pacing up.
    PaceUpExStart,
    /// Stopped extended pacing up.
    PaceUpExEnd,
    /// Began overtaking.
    OvertakeStart,
    /// Stopped overtaking.
    OvertakeEnd,
    /// Became side-blocked.
    BlockedSideStart,
    /// Stopped being side-blocked.
    BlockedSideEnd,
    /// Entered mid race (phase 0 -> 1).
    MidRaceStart,
    /// Entered late race (phase 1 -> 2).
    LateRaceStart,
}

/// Optional detail payload for a [`RaceLogEvent`].
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RaceLogEventDetail {
    /// The skill id (skill-activated events).
    pub skill_id: Option<String>,
    /// Other runners sharing the state (dueling / spot-struggle events).
    pub other_runner_ids: Vec<RunnerId>,
    /// 1-based finishing place (finished events).
    pub finish_place: Option<u32>,
    /// Finish time in seconds (finished events).
    pub finish_time: Option<f64>,
}

/// A single logged race event (port of TS `RaceEvent`).
#[derive(Debug, Clone, PartialEq)]
pub struct RaceLogEvent {
    /// The event kind.
    pub kind: RaceLogEventKind,
    /// The runner the event is about.
    pub runner_id: RunnerId,
    /// Position in meters (clamped to the course distance).
    pub position: f64,
    /// Tick index (0-based) at which the event occurred.
    pub tick: i64,
    /// Optional detail payload.
    pub detail: Option<RaceLogEventDetail>,
}

/// Per-round logged events.
pub type RaceEventLog = Vec<Vec<RaceLogEvent>>;

/// One runner's previous-tick state used for transition diffing.
#[derive(Clone, Default)]
struct RunnerPrevState {
    is_rushed: bool,
    is_dueling: bool,
    in_spot_struggle: bool,
    is_fully_charged: bool,
    is_last_spurt: bool,
    out_of_hp: bool,
    skills_activated_count: i64,
    seen_used_skills: HashSet<String>,
    /// Number of received-targeted-skill log entries already turned into
    /// `Debuffed` events (the log is append-only, so this is a high-water mark).
    seen_targeted_count: usize,
    position_keep_state: i64,
    phase: i64,
    is_overtaking: bool,
    is_side_blocked: bool,
}

#[derive(Default)]
struct EventLogInner {
    rounds: RaceEventLog,
    current: Vec<RaceLogEvent>,
    states: HashMap<RunnerId, RunnerPrevState>,
    /// Latest-known dueling / spot-struggle flags per runner (for partner ids).
    live_dueling: HashSet<RunnerId>,
    live_spot: HashSet<RunnerId>,
    finished_count: u32,
}

/// Read-model that projects the lifecycle event stream into a per-round list of
/// [`RaceLogEvent`]s by diffing runner state transitions each tick.
///
/// Port of `race-sim/race-event-log.ts`. Attach [`handle`](Self::handle) as a
/// [`RaceObserver`], run the simulation, then read [`result`](Self::result).
pub struct RaceEventLogCollector {
    inner: Rc<RefCell<EventLogInner>>,
}

impl Default for RaceEventLogCollector {
    fn default() -> Self {
        Self::new()
    }
}

impl RaceEventLogCollector {
    /// A fresh event-log collector.
    pub fn new() -> Self {
        RaceEventLogCollector {
            inner: Rc::new(RefCell::new(EventLogInner::default())),
        }
    }

    /// A boxed observer sharing this collector's storage.
    pub fn handle(&self) -> Box<dyn RaceObserver> {
        Box::new(EventLogObserver {
            inner: Rc::clone(&self.inner),
        })
    }

    /// The per-round event logs collected so far.
    pub fn result(&self) -> RaceEventLog {
        self.inner.borrow().rounds.clone()
    }
}

struct EventLogObserver {
    inner: Rc<RefCell<EventLogInner>>,
}

impl EventLogInner {
    fn current_tick(&self, race: &dyn RaceObservation) -> i64 {
        let one_based = (race.accumulated_time() * TICKS_PER_SECOND).round() as i64;
        (one_based - 1).max(0)
    }

    fn partners(&self, self_id: RunnerId, dueling: bool) -> Vec<RunnerId> {
        let live = if dueling {
            &self.live_dueling
        } else {
            &self.live_spot
        };
        let mut ids: Vec<RunnerId> = live.iter().copied().filter(|&id| id != self_id).collect();
        ids.sort_by_key(|id| id.0);
        ids
    }

    fn push(
        &mut self,
        kind: RaceLogEventKind,
        runner_id: RunnerId,
        position: f64,
        tick: i64,
        detail: Option<RaceLogEventDetail>,
    ) {
        self.current.push(RaceLogEvent {
            kind,
            runner_id,
            position,
            tick,
            detail,
        });
    }
}

impl RaceObserver for EventLogObserver {
    fn on_round_start(&mut self, _race: &dyn RaceObservation, _seed: u64) {
        let mut inner = self.inner.borrow_mut();
        inner.current = Vec::new();
        inner.states.clear();
        inner.live_dueling.clear();
        inner.live_spot.clear();
        inner.finished_count = 0;
    }

    fn on_after_runner_tick(
        &mut self,
        race: &dyn RaceObservation,
        runner: &dyn RunnerObservation,
        _dt: f64,
    ) {
        let mut inner = self.inner.borrow_mut();
        let id = runner.id();
        let tick = inner.current_tick(race);
        let position = runner.position().min(race.course_distance());
        let prev = inner.states.get(&id).cloned().unwrap_or_default();

        let is_rushed = runner.is_rushed();
        let is_dueling = runner.is_dueling();
        let in_spot = runner.in_spot_struggle();
        let is_fully_charged = runner.is_fully_charged();
        let is_last_spurt = runner.is_last_spurt();
        let out_of_hp = runner.out_of_hp();
        let count = runner.skills_activated_count();
        let pk = runner.position_keep_state();
        let phase = runner.phase();
        let overtaking = runner.is_overtaking();
        let side_blocked = runner.is_side_blocked();

        // Keep the live state maps current before computing partner ids.
        if is_dueling {
            inner.live_dueling.insert(id);
        } else {
            inner.live_dueling.remove(&id);
        }
        if in_spot {
            inner.live_spot.insert(id);
        } else {
            inner.live_spot.remove(&id);
        }

        if !prev.is_rushed && is_rushed {
            inner.push(RaceLogEventKind::Rushed, id, position, tick, None);
        }
        if prev.is_rushed && !is_rushed {
            inner.push(RaceLogEventKind::RushedEnd, id, position, tick, None);
        }
        if prev.phase == 0 && phase == 1 {
            inner.push(RaceLogEventKind::MidRaceStart, id, position, tick, None);
        }
        if prev.phase == 1 && phase == 2 {
            inner.push(RaceLogEventKind::LateRaceStart, id, position, tick, None);
        }
        if prev.position_keep_state != PK_PACE_DOWN && pk == PK_PACE_DOWN {
            inner.push(RaceLogEventKind::PaceDownStart, id, position, tick, None);
        }
        if prev.position_keep_state == PK_PACE_DOWN && pk != PK_PACE_DOWN {
            inner.push(RaceLogEventKind::PaceDownEnd, id, position, tick, None);
        }
        if prev.position_keep_state != PK_PACE_UP && pk == PK_PACE_UP {
            inner.push(RaceLogEventKind::PaceUpStart, id, position, tick, None);
        }
        if prev.position_keep_state == PK_PACE_UP && pk != PK_PACE_UP {
            inner.push(RaceLogEventKind::PaceUpEnd, id, position, tick, None);
        }
        if prev.position_keep_state != PK_PACE_UP_EX && pk == PK_PACE_UP_EX {
            inner.push(RaceLogEventKind::PaceUpExStart, id, position, tick, None);
        }
        if prev.position_keep_state == PK_PACE_UP_EX && pk != PK_PACE_UP_EX {
            inner.push(RaceLogEventKind::PaceUpExEnd, id, position, tick, None);
        }
        if !prev.is_overtaking && overtaking {
            inner.push(RaceLogEventKind::OvertakeStart, id, position, tick, None);
        }
        if prev.is_overtaking && !overtaking {
            inner.push(RaceLogEventKind::OvertakeEnd, id, position, tick, None);
        }
        if !prev.is_side_blocked && side_blocked {
            inner.push(RaceLogEventKind::BlockedSideStart, id, position, tick, None);
        }
        if prev.is_side_blocked && !side_blocked {
            inner.push(RaceLogEventKind::BlockedSideEnd, id, position, tick, None);
        }
        if !prev.is_dueling && is_dueling {
            let detail = other_detail(inner.partners(id, true));
            inner.push(RaceLogEventKind::DuelingStart, id, position, tick, detail);
        }
        if prev.is_dueling && !is_dueling {
            let detail = other_detail(inner.partners(id, true));
            inner.push(RaceLogEventKind::DuelingEnd, id, position, tick, detail);
        }
        if !prev.in_spot_struggle && in_spot {
            let detail = other_detail(inner.partners(id, false));
            inner.push(
                RaceLogEventKind::SpotStruggleStart,
                id,
                position,
                tick,
                detail,
            );
        }
        if prev.in_spot_struggle && !in_spot {
            let detail = other_detail(inner.partners(id, false));
            inner.push(
                RaceLogEventKind::SpotStruggleEnd,
                id,
                position,
                tick,
                detail,
            );
        }
        if !prev.is_fully_charged && is_fully_charged {
            inner.push(RaceLogEventKind::FullyCharged, id, position, tick, None);
        }
        if prev.is_fully_charged && !is_fully_charged {
            inner.push(RaceLogEventKind::FullyChargedEnd, id, position, tick, None);
        }
        if !prev.is_last_spurt && is_last_spurt {
            inner.push(RaceLogEventKind::LastSpurt, id, position, tick, None);
        }
        if !prev.out_of_hp && out_of_hp {
            inner.push(RaceLogEventKind::HpOut, id, position, tick, None);
        }

        let mut seen = prev.seen_used_skills.clone();
        if count > prev.skills_activated_count {
            let used = runner.used_skills();
            let new_ids: Vec<String> = used
                .iter()
                .filter(|s| !seen.contains(**s))
                .map(|s| (*s).to_owned())
                .collect();
            for skill_id in &new_ids {
                inner.push(
                    RaceLogEventKind::SkillActivated,
                    id,
                    position,
                    tick,
                    Some(RaceLogEventDetail {
                        skill_id: Some(skill_id.clone()),
                        ..Default::default()
                    }),
                );
            }
            let delta = count - prev.skills_activated_count;
            let remaining = (delta - new_ids.len() as i64).max(0);
            for _ in 0..remaining {
                inner.push(RaceLogEventKind::SkillActivated, id, position, tick, None);
            }
            for s in used {
                seen.insert(s.to_owned());
            }
        }

        // Newly received debuffs (cross-runner external debuffs or injected
        // debuffs) appended to the runner's targeted-skill log since last tick.
        let targeted = runner.used_targeted_skills();
        let seen_targeted = targeted.len().max(prev.seen_targeted_count);
        if targeted.len() > prev.seen_targeted_count {
            for entry in &targeted[prev.seen_targeted_count..] {
                inner.push(
                    RaceLogEventKind::Debuffed,
                    id,
                    position,
                    tick,
                    Some(RaceLogEventDetail {
                        skill_id: Some(entry.skill_id.clone()),
                        ..Default::default()
                    }),
                );
            }
        }

        inner.states.insert(
            id,
            RunnerPrevState {
                is_rushed,
                is_dueling,
                in_spot_struggle: in_spot,
                is_fully_charged,
                is_last_spurt,
                out_of_hp,
                skills_activated_count: count,
                seen_used_skills: seen,
                seen_targeted_count: seen_targeted,
                position_keep_state: pk,
                phase,
                is_overtaking: overtaking,
                is_side_blocked: side_blocked,
            },
        );
    }

    fn on_runner_finished(&mut self, race: &dyn RaceObservation, runner: &dyn RunnerObservation) {
        let mut inner = self.inner.borrow_mut();
        let tick = inner.current_tick(race);
        let position = runner.position().min(race.course_distance());
        inner.finished_count += 1;
        let place = inner.finished_count;
        inner.push(
            RaceLogEventKind::Finished,
            runner.id(),
            position,
            tick,
            Some(RaceLogEventDetail {
                finish_place: Some(place),
                finish_time: Some(runner.finish_time()),
                ..Default::default()
            }),
        );
    }

    fn on_round_end(&mut self, _race: &dyn RaceObservation) {
        let mut inner = self.inner.borrow_mut();
        let round = std::mem::take(&mut inner.current);
        inner.rounds.push(round);
    }
}

/// Build an "other runners in state" detail, or `None` when empty.
fn other_detail(other_runner_ids: Vec<RunnerId>) -> Option<RaceLogEventDetail> {
    if other_runner_ids.is_empty() {
        None
    } else {
        Some(RaceLogEventDetail {
            other_runner_ids,
            ..Default::default()
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct DummyRace;
    impl RaceObservation for DummyRace {}

    struct DummyRunner {
        id: u32,
        pos: f64,
    }
    impl RunnerObservation for DummyRunner {
        fn id(&self) -> RunnerId {
            RunnerId(self.id)
        }
        fn position(&self) -> f64 {
            self.pos
        }
    }

    #[test]
    fn collects_focus_runner_samples_only() {
        let collector = RaceSimDataCollector::new(vec![RunnerId(1)]);
        let mut obs = collector.handle();
        obs.on_round_start(&DummyRace, 42);
        obs.on_after_runner_tick(&DummyRace, &DummyRunner { id: 0, pos: 10.0 }, 0.0625);
        obs.on_after_runner_tick(&DummyRace, &DummyRunner { id: 1, pos: 20.0 }, 0.0625);
        obs.on_after_runner_tick(&DummyRace, &DummyRunner { id: 1, pos: 30.0 }, 0.0625);

        let data = collector.result();
        assert_eq!(data.rounds.len(), 1);
        assert_eq!(data.rounds[0].seed, 42);
        assert_eq!(data.rounds[0].focus.len(), 1);
        assert_eq!(data.rounds[0].focus[0].runner_id, RunnerId(1));
        assert_eq!(data.rounds[0].focus[0].samples.len(), 2);
        assert_eq!(data.rounds[0].focus[0].samples[1].position, 30.0);
    }

    /// Configurable runner double for event-log diffing.
    #[derive(Default)]
    struct LogRunner {
        id: u32,
        pos: f64,
        finish_time: f64,
        is_rushed: bool,
        is_dueling: bool,
        in_spot: bool,
        is_last_spurt: bool,
        out_of_hp: bool,
        count: i64,
        pk: i64,
        phase: i64,
        used: Vec<String>,
    }
    impl RunnerObservation for LogRunner {
        fn id(&self) -> RunnerId {
            RunnerId(self.id)
        }
        fn position(&self) -> f64 {
            self.pos
        }
        fn finish_time(&self) -> f64 {
            self.finish_time
        }
        fn is_rushed(&self) -> bool {
            self.is_rushed
        }
        fn is_dueling(&self) -> bool {
            self.is_dueling
        }
        fn in_spot_struggle(&self) -> bool {
            self.in_spot
        }
        fn is_last_spurt(&self) -> bool {
            self.is_last_spurt
        }
        fn out_of_hp(&self) -> bool {
            self.out_of_hp
        }
        fn skills_activated_count(&self) -> i64 {
            self.count
        }
        fn position_keep_state(&self) -> i64 {
            self.pk
        }
        fn phase(&self) -> i64 {
            self.phase
        }
        fn used_skills(&self) -> Vec<&str> {
            self.used.iter().map(String::as_str).collect()
        }
    }

    struct LogRace {
        time: f64,
    }
    impl RaceObservation for LogRace {
        fn course_distance(&self) -> f64 {
            2400.0
        }
        fn accumulated_time(&self) -> f64 {
            self.time
        }
    }

    fn kinds(events: &[RaceLogEvent]) -> Vec<RaceLogEventKind> {
        events.iter().map(|e| e.kind).collect()
    }

    #[test]
    fn event_log_diffs_state_transitions() {
        let collector = RaceEventLogCollector::new();
        let mut obs = collector.handle();
        obs.on_round_start(&LogRace { time: 0.0 }, 1);

        // Tick 1: runner enters rushed + activates a named skill.
        obs.on_after_runner_tick(
            &LogRace { time: 1.0 },
            &LogRunner {
                id: 0,
                pos: 300.0,
                is_rushed: true,
                count: 1,
                used: vec!["100001".to_owned()],
                ..Default::default()
            },
            0.066,
        );
        // Tick 2: leaves rushed, enters last spurt.
        obs.on_after_runner_tick(
            &LogRace { time: 2.0 },
            &LogRunner {
                id: 0,
                pos: 320.0,
                is_last_spurt: true,
                count: 1,
                used: vec!["100001".to_owned()],
                ..Default::default()
            },
            0.066,
        );
        obs.on_runner_finished(
            &LogRace { time: 3.0 },
            &LogRunner {
                id: 0,
                pos: 2400.0,
                finish_time: 142.5,
                ..Default::default()
            },
        );
        obs.on_round_end(&LogRace { time: 3.0 });

        let rounds = collector.result();
        assert_eq!(rounds.len(), 1);
        let events = &rounds[0];
        assert_eq!(
            kinds(events),
            vec![
                RaceLogEventKind::Rushed,
                RaceLogEventKind::SkillActivated,
                RaceLogEventKind::RushedEnd,
                RaceLogEventKind::LastSpurt,
                RaceLogEventKind::Finished,
            ]
        );
        // Tick numbering: round(1.0*15)-1 = 14.
        assert_eq!(events[0].tick, 14);
        // Skill detail carries the id.
        assert_eq!(
            events[1].detail.as_ref().and_then(|d| d.skill_id.clone()),
            Some("100001".to_owned())
        );
        // Finished detail carries place + time.
        let finished = events.last().expect("finished event");
        let detail = finished.detail.as_ref().expect("detail");
        assert_eq!(detail.finish_place, Some(1));
        assert_eq!(detail.finish_time, Some(142.5));
        assert_eq!(finished.position, 2400.0);
    }

    #[test]
    fn dueling_partners_are_reported() {
        let collector = RaceEventLogCollector::new();
        let mut obs = collector.handle();
        obs.on_round_start(&LogRace { time: 0.0 }, 1);
        let race = LogRace { time: 5.0 };
        // Runner 1 already dueling (seen this tick), then runner 0 starts dueling.
        obs.on_after_runner_tick(
            &race,
            &LogRunner {
                id: 1,
                pos: 2000.0,
                is_dueling: true,
                ..Default::default()
            },
            0.066,
        );
        obs.on_after_runner_tick(
            &race,
            &LogRunner {
                id: 0,
                pos: 2001.0,
                is_dueling: true,
                ..Default::default()
            },
            0.066,
        );
        obs.on_round_end(&race);

        let rounds = collector.result();
        let start = rounds[0]
            .iter()
            .find(|e| e.kind == RaceLogEventKind::DuelingStart && e.runner_id == RunnerId(0))
            .expect("runner 0 dueling-start");
        let partners = &start.detail.as_ref().expect("detail").other_runner_ids;
        assert_eq!(partners, &vec![RunnerId(1)]);
    }
}
