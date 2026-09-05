//! The `Race` **aggregate root** (port of `common/race.ts`).
//!
//! Owns the field of [`Runner`]s and is the only thing that mutates them. The
//! tick loop is **snapshot-based** (see `.plans/.../context.md`): each frame
//! builds one immutable [`FieldSnapshot`] from the *current* state, then steps
//! every runner against that same frozen snapshot, so resolution order is
//! irrelevant and there is no intra-frame state drift.
//!
//! Runners are stored in a `Vec<Runner>` indexed by their `RunnerId` (assigned
//! in insertion order) — deterministic iteration without the overhead of a map,
//! and contiguous for the slice-based pacing / coordinator services.

use std::collections::HashMap;

use uma_sim_primitives::course::model::CourseData;
use uma_sim_primitives::events::{RaceObservation, RaceObserver, RaceObservers};
use uma_sim_primitives::position_keep::{update_position_keep_coefficient, PositionKeepContext};
use uma_sim_primitives::race_support::{
    assign_gates, build_field_snapshot, build_field_view, front_blocking_runner,
    has_side_blocking_runner, is_overtaking_runner, proximity_snapshots, resolve_debuff_targets,
    FieldOrderTracker, FieldSnapshot,
};
use uma_sim_primitives::runner::lifecycle::{CreateRunner, PrepareContext};
use uma_sim_primitives::runner::physics::{
    update_first_position_in_late_race, DuelingInput, FieldInputs, RunnerSnapshot,
    SkillTriggerInputs, UpdateContext,
};
use uma_sim_primitives::runner::skills::FieldView;
use uma_sim_primitives::runner::Runner;
use uma_sim_primitives::shared_kernel::ids::RunnerId;
use uma_sim_primitives::shared_kernel::language::{strategy_matches, GroundCondition, Strategy};
use uma_sim_primitives::shared_kernel::params::RaceParameters;
use uma_sim_primitives::shared_kernel::region::{Region, RegionList};
use uma_sim_primitives::shared_kernel::rng::{Prng, Xoshiro256StarStar};
use uma_sim_primitives::skills::condition::catalog::build_catalog;
use uma_sim_primitives::skills::condition::dynamic::register_all_dynamic_conditions;
use uma_sim_primitives::skills::condition::language::ConditionParser;
use uma_sim_primitives::skills::condition::{ConditionCatalog, ConditionResolution};
use uma_sim_primitives::stamina::game_policy::GameStaminaPolicy;
use uma_sim_primitives::stamina::policy::{NoopStaminaPolicy, StaminaPolicy};

/// Frame duration (15 FPS).
const FRAME_DT: f64 = 1.0 / 15.0;

/// Toggles and tuning that configure a simulation run.
#[derive(Debug, Clone)]
pub struct SimulationSettings {
    /// Whether the game stamina policy (HP) is active.
    pub health_system: bool,
    /// Whether per-section wisdom variance is applied (currently always on).
    pub section_modifier: bool,
    /// Whether the rushed (temptation) mechanic is enabled by default.
    pub rushed: bool,
    /// Per-runner rushed settings, by runner insertion index. Entries override
    /// the default; unlisted runners (such as generated mobs) use `rushed`.
    pub rushed_runners: Vec<bool>,
    /// Whether downhill mode is enabled by default.
    pub downhill: bool,
    /// Per-runner downhill settings, by runner insertion index. Entries
    /// override the default; unlisted runners use `downhill`.
    pub downhill_runners: Vec<bool>,
    /// Whether Power Conservation / Fully Charged is enabled by default.
    pub conserve_power: bool,
    /// Per-runner Power Conservation settings, by runner insertion index.
    /// Entries override the default; unlisted runners use `conserve_power`.
    pub conserve_power_runners: Vec<bool>,
    /// Whether spot-struggle is enabled.
    pub spot_struggle: bool,
    /// Whether dueling is enabled.
    pub dueling: bool,
    /// Whether wit checks gate skill activation by default.
    pub wit_checks: bool,
    /// Per-runner wit-check settings, by runner insertion index. Entries
    /// override the default; unlisted runners (such as generated mobs) use
    /// `wit_checks`.
    pub wit_checks_runners: Vec<bool>,
    /// Position-keep mode (`2` enables virtual position keeping).
    pub position_keep_mode: i32,
    /// Number of activation samples drawn per skill trigger.
    pub skill_samples: usize,
    /// Per-base-skill recovery (stamina-drain) override modifiers.
    pub stamina_drain_overrides: HashMap<String, f64>,
}

impl Default for SimulationSettings {
    fn default() -> Self {
        SimulationSettings {
            health_system: true,
            section_modifier: true,
            rushed: true,
            rushed_runners: Vec::new(),
            downhill: true,
            downhill_runners: Vec::new(),
            conserve_power: true,
            conserve_power_runners: Vec::new(),
            spot_struggle: true,
            dueling: true,
            wit_checks: true,
            wit_checks_runners: Vec::new(),
            position_keep_mode: 2,
            skill_samples: 1,
            stamina_drain_overrides: HashMap::new(),
        }
    }
}

/// The race aggregate root.
pub struct Race {
    /// The course being raced.
    pub course: CourseData,
    /// Ground condition.
    pub ground: GroundCondition,
    /// Simulation settings.
    pub settings: SimulationSettings,
    /// Race-wide parameters (augmented with field composition at prepare time).
    pub race_params: RaceParameters,

    /// The field, indexed by `RunnerId`.
    runners: Vec<Runner>,
    /// Ids of finished runners, in finish order (append-only).
    finished_runners: Vec<RunnerId>,

    /// The static condition catalog (owns the parser's backing data).
    catalog: ConditionCatalog,
    /// The whole course as a region list.
    whole_course: RegionList,
    /// Round index (selects which sampled trigger fires).
    round_iteration: usize,
    /// Elapsed race time in seconds.
    accumulated_time: f64,
    /// Master seed of the current round.
    seed: u64,
    /// The race RNG (drives gate assignment + per-runner sub-streams).
    rng: Box<dyn Prng>,

    /// Pacer + finishing-order state, threaded across frames.
    order_tracker: FieldOrderTracker,
    /// Per-strategy counts.
    strategy_counts: HashMap<Strategy, u32>,
    /// Common (shared) skills across the field.
    common_skills: HashMap<String, u32>,
    /// Field-global spot-struggle unlock: set once ANY runner passes 150m this
    /// round (hakuraku.moe/notes/spot-struggle: one uma passing 150m unlocks
    /// the mechanic for the whole field).
    spot_struggle_unlocked: bool,
    /// Styles that already triggered spot struggle this round (each style
    /// triggers at most once per race).
    spot_struggle_triggered: Vec<Strategy>,

    /// Lifecycle observers.
    observers: RaceObservers,
}

impl RaceObservation for Race {
    fn course_distance(&self) -> f64 {
        self.course.distance
    }
    fn pacer_position(&self) -> Option<f64> {
        self.order_tracker.pacer_position
    }
    fn runner_order(&self, id: RunnerId) -> Option<i64> {
        self.order_tracker.runner_order.get(&id).copied()
    }
    fn seed(&self) -> u64 {
        self.seed
    }
    fn accumulated_time(&self) -> f64 {
        self.accumulated_time
    }
    fn max_lane_distance(&self) -> f64 {
        self.course.max_lane_distance
    }
    fn course_width(&self) -> f64 {
        self.course.course_width
    }
}

impl Race {
    /// Build a race for a course/ground with the given settings + parameters.
    ///
    /// Registers the dynamic condition catalog once and builds the static
    /// catalog + whole-course regions.
    pub fn new(
        course: CourseData,
        ground: GroundCondition,
        settings: SimulationSettings,
        race_params: RaceParameters,
    ) -> Self {
        register_all_dynamic_conditions();
        let mut whole_course = RegionList::new();
        whole_course.push(Region::new(0.0, course.distance));
        Race {
            ground,
            settings,
            race_params,
            runners: Vec::new(),
            finished_runners: Vec::new(),
            catalog: build_catalog(),
            whole_course,
            round_iteration: 0,
            accumulated_time: 0.0,
            seed: 0,
            rng: Box::new(Xoshiro256StarStar::from_u64_seed(0)),
            order_tracker: FieldOrderTracker::new(),
            strategy_counts: HashMap::new(),
            common_skills: HashMap::new(),
            spot_struggle_unlocked: false,
            spot_struggle_triggered: Vec::new(),
            observers: RaceObservers::new(),
            course,
        }
    }

    /// Course base speed: `20 - (distance - 2000) / 1000`.
    pub fn base_speed(&self) -> f64 {
        20.0 - (self.course.distance - 2000.0) / 1000.0
    }

    /// Number of runners in the field.
    pub fn runner_count(&self) -> usize {
        self.runners.len()
    }

    /// Read-only access to the field.
    pub fn runners(&self) -> &[Runner] {
        &self.runners
    }

    /// Finish order (runner ids).
    pub fn finished_runners(&self) -> &[RunnerId] {
        &self.finished_runners
    }

    /// Register a lifecycle observer.
    pub fn subscribe(&mut self, observer: Box<dyn RaceObserver>) {
        self.observers.subscribe(observer);
    }

    /// Add a runner to the field (assigns the next `RunnerId`).
    pub fn add_runner(&mut self, props: CreateRunner) -> RunnerId {
        let id = RunnerId(self.runners.len() as u32);
        let runner = Runner::create(
            id,
            &self.course,
            self.ground,
            props,
            Box::new(NoopStaminaPolicy),
            Box::new(Xoshiro256StarStar::from_u32_seed(id.0)),
        );
        self.runners.push(runner);
        id
    }

    /// Prepare the field for a round: count field composition, assign gates,
    /// spawn per-runner RNGs + stamina policies, and reset every runner.
    pub fn prepare_round(&mut self, master_seed: u64) {
        self.accumulated_time = 0.0;
        self.finished_runners.clear();
        self.order_tracker.reset();
        self.spot_struggle_unlocked = false;
        self.spot_struggle_triggered.clear();

        self.prepare_race();

        self.seed = master_seed;
        self.rng = Box::new(Xoshiro256StarStar::from_u64_seed(master_seed));

        let base_speed = self.base_speed();
        let parser = ConditionParser::new(&self.catalog);

        let fixed_gates: Vec<Option<i64>> = self.runners.iter().map(|r| r.fixed_gate).collect();
        let gates = assign_gates(&fixed_gates, self.runners.len(), &mut *self.rng);

        let mut runners = std::mem::take(&mut self.runners);
        for (idx, runner) in runners.iter_mut().enumerate() {
            runner.gate = gates[idx];
            let runner_rng: Box<dyn Prng> =
                Box::new(Xoshiro256StarStar::from_u32_seed(self.rng.int32()));
            let policy: Box<dyn StaminaPolicy> = if self.settings.health_system {
                let hp_rng: Box<dyn Prng> =
                    Box::new(Xoshiro256StarStar::from_u32_seed(self.rng.int32()));
                Box::new(GameStaminaPolicy::new(&self.course, self.ground, hp_rng))
            } else {
                Box::new(NoopStaminaPolicy)
            };
            runner.health_policy = policy;
            runner.wit_checks_enabled = self
                .settings
                .wit_checks_runners
                .get(idx)
                .copied()
                .unwrap_or(self.settings.wit_checks);
            runner.rushed_enabled = self
                .settings
                .rushed_runners
                .get(idx)
                .copied()
                .unwrap_or(self.settings.rushed);
            runner.dueling_enabled = self.settings.dueling;
            runner.spot_struggle_enabled = self.settings.spot_struggle;
            runner.downhill_enabled = self
                .settings
                .downhill_runners
                .get(idx)
                .copied()
                .unwrap_or(self.settings.downhill);
            runner.conserve_power_enabled = self
                .settings
                .conserve_power_runners
                .get(idx)
                .copied()
                .unwrap_or(self.settings.conserve_power);
            runner
                .stamina_drain_overrides
                .clone_from(&self.settings.stamina_drain_overrides);

            let ctx = PrepareContext {
                course: &self.course,
                base_speed,
                // Contested engine: live dynamic predicates + the ×10
                // position-keep window (mechanics § Position Keeping: sections
                // 1–10). ADR-0005 previously inherited ×3 from the retired TS
                // reference; both engines now match canon.
                condition_resolution: ConditionResolution::Dynamic,
                pos_keep_end_multiplier: 10.0,
                race_params: &self.race_params,
                whole_course: &self.whole_course,
                parser: &parser,
                skill_samples: self.settings.skill_samples,
                round_iteration: self.round_iteration,
            };
            runner.on_prepare(runner_rng, &ctx);
        }
        self.runners = runners;

        self.round_iteration += 1;
        self.emit_round_start(master_seed);
        self.emit_runners_prepared();
    }

    /// Tally field composition and fold it into `race_params` (always, for the
    /// contested field).
    fn prepare_race(&mut self) {
        let mut strategy_counts: HashMap<Strategy, u32> = HashMap::new();
        let mut common_skills: HashMap<String, u32> = HashMap::new();
        for runner in &self.runners {
            *strategy_counts.entry(runner.strategy).or_insert(0) += 1;
            for skill in &runner.skills {
                *common_skills.entry(skill.skill_id.0.clone()).or_insert(0) += 1;
            }
        }
        self.strategy_counts = strategy_counts.clone();
        self.common_skills = common_skills.clone();

        self.race_params.num_umas = Some(self.runners.len() as u32);
        self.race_params.strategy_counts = Some(strategy_counts);
        self.race_params.common_skills = Some(common_skills);
    }

    /// Run the race to completion (every runner finished).
    pub fn run(&mut self) {
        while self.finished_runners.len() < self.runners.len() {
            self.on_update(FRAME_DT);
        }
        self.emit_round_end();
    }

    /// Advance the whole field one `dt`-second step (snapshot-based).
    pub fn on_update(&mut self, dt: f64) {
        self.emit_before_tick(dt);
        self.accumulated_time += dt;

        let snapshot = build_field_snapshot(
            &mut self.runners,
            &self.finished_runners,
            &mut self.order_tracker,
        );
        let proximity = proximity_snapshots(&snapshot);

        let base_speed = self.base_speed();
        let mut runners = std::mem::take(&mut self.runners);
        for runner in &mut runners {
            if self.finished_runners.contains(&runner.id) {
                continue;
            }
            update_position_keep_coefficient(runner);
            let field = build_field_view(runner.id, &snapshot);
            let backward_strategy_runner_ahead = snapshot.entries.iter().any(|entry| {
                entry.position > runner.position
                    && entry.strategy.order_rank() > runner.position_keep_strategy.order_rank()
            });
            let only_front_runner = snapshot
                .entries
                .iter()
                .filter(|entry| strategy_matches(entry.strategy, Strategy::FrontRunner))
                .count()
                == 1;
            let position_keep = PositionKeepContext {
                position_keep_mode: self.settings.position_keep_mode,
                num_runners: snapshot.num_active as usize,
                field_size: snapshot.num_total as usize,
                pacer_position: snapshot.pacer_position,
                pacer_strategy: snapshot.pacer_strategy,
                pacer_is_self: snapshot.pacer == Some(runner.id),
                second_place_position: snapshot.second_place_position,
                backward_strategy_runner_ahead,
                only_front_runner,
            };
            // The aggregate is the *producer*: it resolves every field-presence
            // input from the **live field** (ADR-0005 contested producer) and
            // hands the step a pure `FieldInputs` plus a field-free course
            // context. There is no paradigm branch.
            let field_inputs = resolve_field_inputs(
                runner,
                &proximity,
                &field,
                position_keep,
                self.course.horse_lane,
            );
            let ctx = UpdateContext {
                base_speed,
                accumulated_time: self.accumulated_time,
                course: &self.course,
            };
            runner.on_update(dt, &field_inputs, &ctx);
        }
        self.runners = runners;

        // Route opponent-facing debuffs that runners emitted this frame onto the
        // runners they target (Hesitant family, Wild Wind / Speed Eater, ...).
        // Runners only *emit* during their own update; the aggregate *commits*
        // the cross-runner application here, against the same frozen snapshot.
        self.coordinate_external_debuffs(&snapshot);

        // Cross-runner coordinator passes: contention mechanics that
        // observe/mutate the rest of the field. These run as aggregate passes
        // over the just-updated field so resolution order is irrelevant.
        if self.settings.dueling {
            self.coordinate_proximity_dueling();
        }
        if self.settings.spot_struggle {
            self.coordinate_spot_struggle_groups();
            self.coordinate_spot_struggle_exits();
        }

        update_first_position_in_late_race(&mut self.runners, self.course.distance);

        self.emit_runner_ticks_and_finishes(dt);
    }

    /// **External-debuff routing** coordinator. Drains every runner's per-frame
    /// emitted-debuff outbox (populated when the runner activated a skill with an
    /// opponent-facing effect) and applies each effect onto the resolved target
    /// runners through the existing targeted-effect path
    /// ([`Runner::receive_targeted_effect`]). The caster never receives its own
    /// external effect; finished runners (absent from the snapshot) are not hit.
    ///
    /// Determinism: outboxes are drained in ascending `RunnerId` order and
    /// targets are resolved from the frozen frame snapshot. Effect modifiers add
    /// commutatively, so multiple sources debuffing one target in a frame yield
    /// an order-independent result.
    fn coordinate_external_debuffs(&mut self, snapshot: &FieldSnapshot) {
        let course_distance = self.course.distance;

        // Phase 1: drain outboxes (RunnerId order) and resolve target ids.
        struct Route {
            target: RunnerId,
            source: RunnerId,
            source_team: Option<i32>,
            skill_id: uma_sim_primitives::shared_kernel::ids::SkillId,
            effect: uma_sim_primitives::skills::model::ResolvedSkillEffect,
        }
        let mut routes: Vec<Route> = Vec::new();
        for runner in &mut self.runners {
            if runner.emitted_debuffs.is_empty() {
                continue;
            }
            let source = runner.id;
            let source_team = runner.team;
            let emitted = std::mem::take(&mut runner.emitted_debuffs);
            for debuff in emitted {
                let targets =
                    resolve_debuff_targets(snapshot, source, debuff.target, debuff.target_strategy);
                for target in targets {
                    routes.push(Route {
                        target,
                        source,
                        source_team,
                        skill_id: debuff.skill_id.clone(),
                        effect: debuff.effect,
                    });
                }
            }
        }

        // Phase 2: apply onto each target via the targeted-effect path.
        // Teammates stay valid *targets* (they count toward a skill's maximum
        // target in-game) but are excluded from the debuff *effect*
        // (docs/mechanics/README.md § Skill Target), so the exclusion happens
        // here at application, after target resolution.
        for route in routes {
            let Some(target) = self.runners.iter_mut().find(|r| r.id == route.target) else {
                continue;
            };
            if route.source_team.is_some() && route.source_team == target.team {
                continue;
            }
            target.receive_targeted_effect(
                route.skill_id.clone(),
                vec![route.effect],
                route.source,
                course_distance,
            );
            self.observers
                .emit_debuff_routed(route.source, route.target, &route.skill_id);
        }
    }

    /// Normal-mode **proximity dueling** coordinator (port of `proximityDueling`).
    ///
    /// A runner may begin dueling when it is in the top half of the field, on
    /// the final straight, and bunched together (distance/lane/speed) with at
    /// least one other top-half runner who is also on the final straight. Runs
    /// as an aggregate pass so every runner observes the same field.
    fn coordinate_proximity_dueling(&mut self) {
        const MAX_DISTANCE_GAP: f64 = 3.0;
        const MAX_SPEED_GAP: f64 = 0.6;
        /// `TargetContinueDistance`: exit once separated by >=5m (either
        /// direction) from every current-or-former duel participant.
        const EXIT_DISTANCE_GAP: f64 = 5.0;

        let order = self.order_tracker.runner_order.clone();
        let num = order.len();
        if num == 0 {
            return;
        }
        let top_half_cutoff = ((num as f64) / 2.0).ceil() as i64;
        let course_width = self.course.course_width;
        let max_lane_gap = 0.25 * course_width;

        // Phase 1: read-only snapshot of contention-relevant state.
        struct Row {
            id: RunnerId,
            order: Option<i64>,
            position: f64,
            lane: f64,
            speed: f64,
            hp_ratio: f64,
            on_final_straight: bool,
            is_dueling: bool,
            forced_dueling: bool,
            has_dueled: bool,
            eligible: bool,
        }
        let rows: Vec<Row> = self
            .runners
            .iter()
            .filter(|r| !r.finished)
            .map(|r| {
                let on_final = r.is_on_final_straight(&self.course);
                // No strategy exclusion (canon: docs/mechanics/README.md
                // "Dueling"; hakuraku.moe/notes/dueling). Former duel
                // participants never re-enter a duel. The initiator does NOT
                // need to be on the final straight during the window - only
                // the target does; the initiator's own straight check happens
                // at the trigger frame (replay evidence: Maru duels 1.93s
                // after entering the straight, so her window ran while she
                // was still in the corner).
                let eligible =
                    r.dueling_enabled && !r.is_dueling && !r.is_in_forced_dueling && !r.has_dueled;
                Row {
                    id: r.id,
                    order: order.get(&r.id).copied(),
                    position: r.position,
                    lane: r.current_lane,
                    speed: r.current_speed,
                    hp_ratio: r.health_policy.health_ratio_remaining(),
                    on_final_straight: on_final,
                    is_dueling: r.is_dueling,
                    forced_dueling: r.is_in_forced_dueling,
                    has_dueled: r.has_dueled,
                    eligible,
                }
            })
            .collect();

        // Phase 2: decide each eligible runner's dueling transition.
        //
        // The 2s window (`TargetContinueTime`) applies to PROXIMITY only
        // (<=3m, <=0.25*CourseWidth). Speed, HP, and placement are
        // single-frame checks once the window has elapsed
        // (hakuraku.moe/notes/dueling, "Which conditions must be maintained
        // for 2 seconds?").
        enum DuelDecision {
            ClearCanDuel,
            ArmCanDuel,
            StartDuel,
            None,
        }
        let mut decisions: Vec<(RunnerId, DuelDecision)> = Vec::new();
        for row in &rows {
            if !row.eligible {
                continue;
            }
            // Proximity partners sustain the window. Former duelers cannot be
            // targets; ACTIVE duelers can (joining an ongoing duel).
            let partners: Vec<&Row> = rows
                .iter()
                .filter(|other| {
                    other.id != row.id
                        && !other.has_dueled
                        && other.on_final_straight
                        && (other.position - row.position).abs() <= MAX_DISTANCE_GAP
                        && (other.lane - row.lane).abs() <= max_lane_gap
                })
                .collect();
            if partners.is_empty() {
                decisions.push((row.id, DuelDecision::ClearCanDuel));
                continue;
            }
            let Some(runner) = self.runners.iter().find(|r| r.id == row.id) else {
                continue;
            };
            if runner.can_duel != Some(true) {
                decisions.push((row.id, DuelDecision::ArmCanDuel));
                continue;
            }
            if runner.dueling_timer.t < 2.0 {
                decisions.push((row.id, DuelDecision::None));
                continue;
            }
            // Trigger-frame checks: the initiator is on the final straight,
            // both umas >=15% HP, speed gap <0.6 m/s, and at least ONE of the
            // pair in the top half (that uma is the duel target - only the
            // target needs the placement).
            let row_top_half = matches!(row.order, Some(o) if o <= top_half_cutoff);
            let triggered = row.on_final_straight
                && row.hp_ratio >= 0.15
                && partners.iter().any(|p| {
                    let p_top_half = matches!(p.order, Some(o) if o <= top_half_cutoff);
                    p.hp_ratio >= 0.15
                        && (p.speed - row.speed).abs() < MAX_SPEED_GAP
                        && (row_top_half || p_top_half)
                });
            decisions.push((
                row.id,
                if triggered {
                    DuelDecision::StartDuel
                } else {
                    // Window persists while proximity holds; the trigger
                    // conditions only need one frame to line up.
                    DuelDecision::None
                },
            ));
        }

        // Phase 2b: distance-based exits. An active dueler leaves once she is
        // >=5m away (ahead OR behind) from EVERY current-or-former duel
        // participant; former participants still count for keeping a duel
        // alive (hakuraku.moe/notes/dueling, "Exit conditions").
        let mut exits: Vec<RunnerId> = Vec::new();
        for row in rows.iter().filter(|r| r.is_dueling && !r.forced_dueling) {
            let participants: Vec<&Row> = rows
                .iter()
                .filter(|o| o.id != row.id && (o.is_dueling || o.has_dueled))
                .collect();
            if !participants.is_empty()
                && participants
                    .iter()
                    .all(|o| (o.position - row.position).abs() >= EXIT_DISTANCE_GAP)
            {
                exits.push(row.id);
            }
        }

        // Phase 3: apply.
        for (id, decision) in decisions {
            if let Some(runner) = self.runners.iter_mut().find(|r| r.id == id) {
                match decision {
                    DuelDecision::ClearCanDuel => runner.can_duel = None,
                    DuelDecision::ArmCanDuel => {
                        runner.can_duel = Some(true);
                        runner.dueling_timer.t = 0.0;
                    }
                    DuelDecision::StartDuel => {
                        runner.is_dueling = true;
                        runner.dueling_start_position = runner.position;
                    }
                    DuelDecision::None => {}
                }
            }
        }
        for id in exits {
            if let Some(runner) = self.runners.iter_mut().find(|r| r.id == id) {
                runner.is_dueling = false;
                runner.has_dueled = true;
                runner.dueling_end_position = runner.position;
            }
        }
    }

    /// **Spot-struggle group activation** coordinator (port of the group-trigger
    /// branch of `updateSpotStruggle`). A bunched cluster of same-strategy
    /// front-runners near the front all enter spot-struggle together.
    fn coordinate_spot_struggle_groups(&mut self) {
        // Field-global unlock: ANY uma passing 150m unlocks spot struggle for
        // the whole field, so trailing front runners can trigger before their
        // own 150m mark (hakuraku.moe/notes/spot-struggle, "Entry conditions").
        if !self.spot_struggle_unlocked {
            self.spot_struggle_unlocked = self
                .runners
                .iter()
                .any(|r| r.finished || r.position >= 150.0);
        }
        if !self.spot_struggle_unlocked {
            return;
        }

        // Entry thresholds are identical for both styles: real data shows
        // Oonige does NOT get a wider entry range; the 5.0 / 0.416 constants
        // (`DistanceGap2`/`LaneGap2`) are EXIT thresholds instead.
        const ENTRY_DISTANCE_GAP: f64 = 3.75;
        let entry_lane_gap = 0.165 * self.course.course_width;

        // Phase 1: read-only snapshot.
        struct Row {
            id: RunnerId,
            strategy: Strategy,
            position: f64,
            lane: f64,
            section_length: f64,
        }
        let rows: Vec<Row> = self
            .runners
            .iter()
            .filter(|r| !r.finished && r.spot_struggle_start_position.is_none())
            .map(|r| Row {
                id: r.id,
                strategy: r.strategy,
                position: r.position,
                lane: r.current_lane,
                section_length: r.section_length,
            })
            .collect();

        // Phase 2: per style, gather the group bunched behind the FRONTMOST
        // uma of that style (the frontmost is the reference for the distance
        // check). Each style triggers at most once per race.
        let mut activations: Vec<(RunnerId, f64)> = Vec::new();
        for style in [Strategy::FrontRunner, Strategy::Runaway] {
            if self.spot_struggle_triggered.contains(&style) {
                continue;
            }
            let members: Vec<&Row> = rows.iter().filter(|u| u.strategy == style).collect();
            if members.len() < 2 {
                continue;
            }
            let Some(frontmost) = members
                .iter()
                .max_by(|a, b| a.position.total_cmp(&b.position))
            else {
                continue;
            };
            let group: Vec<&&Row> = members
                .iter()
                .filter(|u| {
                    let behind = frontmost.position - u.position;
                    (0.0..ENTRY_DISTANCE_GAP).contains(&behind)
                        && (u.lane - frontmost.lane).abs() < entry_lane_gap
                })
                .collect();
            if group.len() < 2 {
                continue;
            }
            // Window: at least one grouped uma must still be within section 6
            // (the 150m lower bound is the field-global unlock above).
            let window_end = (frontmost.section_length * 6.0).floor();
            if !group.iter().any(|u| u.position <= window_end) {
                continue;
            }
            self.spot_struggle_triggered.push(style);
            // Spot struggle always ends once section 9 is reached (absolute
            // position), regardless of remaining duration.
            let section9 = (frontmost.section_length * 8.0).floor();
            for uma in group {
                activations.push((uma.id, section9));
            }
        }

        // Phase 3: apply.
        for (id, end) in activations {
            if let Some(runner) = self.runners.iter_mut().find(|r| r.id == id) {
                runner.spot_struggle_timer.t = 0.0;
                runner.in_spot_struggle = true;
                runner.spot_struggle_start_position = Some(runner.position);
                runner.spot_struggle_end_position = end;
            }
        }
    }

    /// **Spot-struggle distance/lateral exit** coordinator
    /// (hakuraku.moe/notes/spot-struggle, "Exit conditions"). An active
    /// struggler exits early when she is >=5m behind ALL other strugglers of
    /// her style, or >=0.416*CourseWidth laterally from all of them. When every
    /// other participant has left via the distance exit, the final struggler
    /// exits too (natural duration expiry does NOT cascade).
    fn coordinate_spot_struggle_exits(&mut self) {
        const EXIT_DISTANCE_GAP: f64 = 5.0;
        let exit_lane_gap = 0.416 * self.course.course_width;

        struct Row {
            id: RunnerId,
            strategy: Strategy,
            position: f64,
            lane: f64,
            active: bool,
            distance_exited: bool,
        }
        let rows: Vec<Row> = self
            .runners
            .iter()
            .filter(|r| r.spot_struggle_start_position.is_some() && !r.is_in_forced_spot_struggle)
            .map(|r| Row {
                id: r.id,
                strategy: r.strategy,
                position: r.position,
                lane: r.current_lane,
                active: r.in_spot_struggle,
                distance_exited: r.spot_struggle_distance_exited,
            })
            .collect();

        let mut exits: Vec<RunnerId> = Vec::new();
        for row in rows.iter().filter(|r| r.active) {
            let others: Vec<&Row> = rows
                .iter()
                .filter(|o| o.id != row.id && o.strategy == row.strategy)
                .collect();
            if others.is_empty() {
                continue;
            }
            let actives: Vec<&&Row> = others.iter().filter(|o| o.active).collect();
            if actives.is_empty() {
                // Cascade: the last active struggler exits only when every
                // other participant left via the distance exit.
                if others.iter().all(|o| o.distance_exited) {
                    exits.push(row.id);
                }
                continue;
            }
            let behind_all = actives
                .iter()
                .all(|o| o.position - row.position >= EXIT_DISTANCE_GAP);
            let lateral_all = actives
                .iter()
                .all(|o| (o.lane - row.lane).abs() >= exit_lane_gap);
            if behind_all || lateral_all {
                exits.push(row.id);
            }
        }

        for id in exits {
            if let Some(runner) = self.runners.iter_mut().find(|r| r.id == id) {
                runner.in_spot_struggle = false;
                runner.spot_struggle_distance_exited = true;
                runner.spot_struggle_end_position = runner.position;
            }
        }
    }

    fn emit_runner_ticks_and_finishes(&mut self, dt: f64) {
        let mut observers = std::mem::take(&mut self.observers);
        let mut newly_finished: Vec<RunnerId> = Vec::new();
        for runner in &self.runners {
            if self.finished_runners.contains(&runner.id) {
                continue;
            }
            observers.emit_after_runner_tick(self, runner, dt);
            if runner.finished {
                newly_finished.push(runner.id);
            }
        }
        for id in newly_finished {
            self.finished_runners.push(id);
            if let Some(runner) = self.runners.iter().find(|r| r.id == id) {
                observers.emit_runner_finished(self, runner);
            }
        }
        self.observers = observers;
    }

    fn emit_round_start(&mut self, seed: u64) {
        let mut observers = std::mem::take(&mut self.observers);
        observers.emit_round_start(self, seed);
        self.observers = observers;
    }

    fn emit_runners_prepared(&mut self) {
        let mut observers = std::mem::take(&mut self.observers);
        for runner in &self.runners {
            observers.emit_runner_prepared(self, runner);
        }
        self.observers = observers;
    }

    fn emit_before_tick(&mut self, dt: f64) {
        let mut observers = std::mem::take(&mut self.observers);
        observers.emit_before_tick(self, dt);
        self.observers = observers;
    }

    fn emit_round_end(&mut self) {
        let mut observers = std::mem::take(&mut self.observers);
        observers.emit_round_end(self);
        self.observers = observers;
    }
}

/// Build the per-runner [`FieldView`] from the frozen snapshot.
/// Resolve the [`FieldInputs`] for one runner this tick, **from the live field**.
///
/// The single seam where field-presence is decided for the contested engine:
/// side-block / overtake come from the live proximity snapshot and dueling is
/// driven by the aggregate coordinator. The step never sees how these were
/// produced.
fn resolve_field_inputs<'a>(
    runner: &Runner,
    snapshots: &[RunnerSnapshot],
    field: &'a FieldView,
    position_keep: PositionKeepContext,
    horse_lane: f64,
) -> FieldInputs<'a> {
    let front_block = front_blocking_runner(runner, snapshots, horse_lane);
    FieldInputs {
        side_blocked: has_side_blocking_runner(runner, snapshots, horse_lane),
        front_block,
        // The closest runner blocking in front is always an overtake target
        // (mechanics § Overtake Targets).
        overtaking: front_block.is_some() || is_overtaking_runner(runner, snapshots, horse_lane),
        dueling: DuelingInput::Coordinated,
        position_keep,
        skill_triggers: SkillTriggerInputs { field },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::rc::Rc;
    use uma_sim_primitives::runner::lifecycle::RunnerAptitudes;
    use uma_sim_primitives::runner::test_support::{test_course, test_race_params};
    use uma_sim_primitives::shared_kernel::language::{Aptitude, Mood};
    use uma_sim_primitives::shared_kernel::params::StatLine;

    struct RoutedDebuffObserver {
        targets: Rc<RefCell<Vec<RunnerId>>>,
    }

    impl RaceObserver for RoutedDebuffObserver {
        fn on_debuff_routed(
            &mut self,
            _source: RunnerId,
            target: RunnerId,
            _skill_id: &uma_sim_primitives::shared_kernel::ids::SkillId,
        ) {
            self.targets.borrow_mut().push(target);
        }
    }

    fn props(name: &str, strategy: Strategy) -> CreateRunner {
        CreateRunner {
            outfit_id: "100302".to_owned(),
            name: name.to_owned(),
            mood: Mood::Normal,
            strategy,
            popularity: 0,
            team: None,
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
            forced_downhill_regions: vec![],
            forced_rank: vec![],
            gate: None,
            forced_start_delay: None,
            forced_last_spurt_distance: None,
        }
    }

    fn race_with(n: u32) -> Race {
        let mut race = Race::new(
            test_course(),
            GroundCondition::Firm,
            SimulationSettings::default(),
            test_race_params(),
        );
        let strategies = [
            Strategy::Runaway,
            Strategy::FrontRunner,
            Strategy::PaceChaser,
            Strategy::LateSurger,
            Strategy::EndCloser,
        ];
        for i in 0..n {
            let s = strategies[(i as usize) % strategies.len()];
            race.add_runner(props(&format!("R{i}"), s));
        }
        race
    }

    #[test]
    fn front_blocker_selects_the_closest_matching_runner() {
        let mut race = race_with(3);
        race.prepare_round(7);
        race.runners[0].position = 100.0;
        race.runners[0].current_lane = 1.0;
        let snapshots = [
            RunnerSnapshot {
                id: RunnerId(0),
                position: 100.0,
                current_lane: 1.0,
                current_speed: 20.0,
            },
            RunnerSnapshot {
                id: RunnerId(1),
                position: 101.0,
                current_lane: 1.0,
                current_speed: 20.0,
            },
            RunnerSnapshot {
                id: RunnerId(2),
                position: 100.5,
                current_lane: 1.1,
                current_speed: 19.0,
            },
            // 2 m ahead is outside the reach.
            RunnerSnapshot {
                id: RunnerId(3),
                position: 102.0,
                current_lane: 1.0,
                current_speed: 18.0,
            },
        ];

        let block = front_blocking_runner(&race.runners[0], &snapshots, race.course.horse_lane)
            .expect("blocked");
        assert_eq!(block.id, RunnerId(2));
        assert_eq!(block.distance_gap, 0.5);
        assert!((block.speed_cap() - (0.988 + 0.012 * 0.25) * 19.0).abs() < 1e-9);
    }

    #[test]
    fn nine_runner_race_finishes_all_deterministically() {
        let mut race = race_with(9);
        race.prepare_round(12345);
        race.run();
        assert_eq!(race.finished_runners().len(), 9);
        // Every runner crossed the line.
        assert!(race.runners().iter().all(|r| r.finished));
        // Finish times are positive and ordered by finish sequence.
        let first = race.finished_runners()[0];
        let winner = race
            .runners()
            .iter()
            .find(|r| r.id == first)
            .expect("winner present");
        assert!(winner.finish_time > 0.0);
    }

    #[test]
    fn same_seed_same_finish_order() {
        let mut a = race_with(9);
        a.prepare_round(777);
        a.run();
        let mut b = race_with(9);
        b.prepare_round(777);
        b.run();
        assert_eq!(a.finished_runners(), b.finished_runners());
    }

    #[test]
    fn per_runner_rushed_settings_override_the_race_default() {
        let settings = SimulationSettings {
            rushed: true,
            rushed_runners: vec![true, false],
            ..SimulationSettings::default()
        };
        let mut race = Race::new(
            test_course(),
            GroundCondition::Firm,
            settings,
            test_race_params(),
        );
        race.add_runner(props("enabled", Strategy::PaceChaser));
        race.add_runner(props("disabled", Strategy::PaceChaser));
        race.prepare_round(42);

        assert!(race.runners[0].rushed_enabled);
        assert!(!race.runners[1].rushed_enabled);

        race.run();
        assert!(race.runners[1].rushed_activations.is_empty());
    }

    #[test]
    fn per_runner_downhill_settings_override_the_race_default() {
        // The runner already carried `downhill_enabled`, but the step read the
        // shared update context instead, so one runner's setting decided the
        // whole field.
        let settings = SimulationSettings {
            downhill: true,
            downhill_runners: vec![false],
            ..SimulationSettings::default()
        };
        let mut race = Race::new(
            test_course(),
            GroundCondition::Firm,
            settings,
            test_race_params(),
        );
        race.add_runner(props("disabled", Strategy::PaceChaser));
        race.add_runner(props("default", Strategy::PaceChaser));
        race.prepare_round(42);

        assert!(!race.runners[0].downhill_enabled);
        assert!(race.runners[1].downhill_enabled);

        race.run();
        // Downhill mode never opens for a runner that has it switched off.
        assert!(!race.runners[0].is_downhill_mode);
    }

    #[test]
    fn per_runner_conserve_power_settings_override_the_race_default() {
        let settings = SimulationSettings {
            conserve_power: true,
            conserve_power_runners: vec![false],
            ..SimulationSettings::default()
        };
        let mut race = Race::new(
            test_course(),
            GroundCondition::Firm,
            settings,
            test_race_params(),
        );
        race.add_runner(props("disabled", Strategy::PaceChaser));
        race.add_runner(props("default", Strategy::PaceChaser));
        race.prepare_round(42);

        assert!(!race.runners[0].conserve_power_enabled);
        assert!(race.runners[1].conserve_power_enabled);
    }

    #[test]
    fn per_runner_wit_checks_override_the_race_default() {
        // A contested field is one race, so a single global flag forced both
        // compared runners onto the same setting. The list is what lets a
        // player turn their own wit rolls off without touching the opponent.
        let settings = SimulationSettings {
            wit_checks: true,
            wit_checks_runners: vec![false],
            ..SimulationSettings::default()
        };
        let mut race = Race::new(
            test_course(),
            GroundCondition::Firm,
            settings,
            test_race_params(),
        );
        race.add_runner(props("disabled", Strategy::PaceChaser));
        race.add_runner(props("default", Strategy::PaceChaser));
        race.prepare_round(42);

        assert!(!race.runners[0].wit_checks_enabled);
        // Unlisted runners, mobs included, keep the race default.
        assert!(race.runners[1].wit_checks_enabled);
    }

    fn hesitant_props(name: &str, strategy: Strategy) -> CreateRunner {
        use uma_sim_primitives::shared_kernel::ids::SkillId;
        use uma_sim_primitives::skills::effect::{SkillRarity, SkillTarget};
        use uma_sim_primitives::skills::model::{RawSkillEffect, Skill, SkillAlternative};
        let mut p = props(name, strategy);
        p.skills = vec![Skill {
            skill_id: SkillId::new("200851"),
            rarity: SkillRarity::White,
            tags: vec![],
            alternatives: vec![SkillAlternative {
                base_duration: 30000.0,
                cooldown_time: None,
                condition: "running_style_count_nige_otherself>=1&phase_random==2".to_owned(),
                precondition: None,
                effects: vec![RawSkillEffect {
                    modifier: -1500.0,
                    target: SkillTarget::EnemyStrategy,
                    effect_type: 21, // Current Speed
                    value_usage: Some(1),
                    value_level_usage: Some(1),
                    pre_applied_multiplier: None,
                }],
            }],
        }];
        p
    }

    fn hesitant_field() -> Race {
        let mut race = Race::new(
            test_course(),
            GroundCondition::Firm,
            SimulationSettings::default(),
            test_race_params(),
        );
        let strategies = [
            Strategy::FrontRunner,
            Strategy::FrontRunner,
            Strategy::PaceChaser,
            Strategy::LateSurger,
            Strategy::EndCloser,
        ];
        for (i, s) in strategies.into_iter().enumerate() {
            race.add_runner(hesitant_props(&format!("R{i}"), s));
        }
        race
    }

    #[test]
    fn cross_runner_debuff_routing_is_deterministic() {
        let mut a = hesitant_field();
        a.prepare_round(2024);
        a.run();
        let mut b = hesitant_field();
        b.prepare_round(2024);
        b.run();
        assert_eq!(a.finished_runners(), b.finished_runners());
        assert_eq!(a.finished_runners().len(), 5);
        // The debuff actually fired: at least one runner received a targeted skill.
        let any_debuffed = a
            .runners()
            .iter()
            .any(|r| !r.used_targeted_skills.is_empty());
        assert!(
            any_debuffed,
            "expected at least one Hesitant debuff to land"
        );
    }

    fn pace_chaser_race(n: u32) -> Race {
        let mut race = Race::new(
            test_course(),
            GroundCondition::Firm,
            SimulationSettings::default(),
            test_race_params(),
        );
        for i in 0..n {
            race.add_runner(props(&format!("R{i}"), Strategy::PaceChaser));
        }
        race
    }

    #[test]
    fn external_debuff_routes_to_matching_strategy_not_self() {
        use uma_sim_primitives::race_support::build_field_snapshot;
        use uma_sim_primitives::shared_kernel::ids::SkillId;
        use uma_sim_primitives::skills::effect::{SkillTarget, SkillType};
        use uma_sim_primitives::skills::model::{EmittedDebuff, ResolvedSkillEffect};

        // R0 caster (Late Surger), R1 Front Runner (target), R2 Pace Chaser.
        let mut race = Race::new(
            test_course(),
            GroundCondition::Firm,
            SimulationSettings::default(),
            test_race_params(),
        );
        race.add_runner(props("caster", Strategy::LateSurger));
        race.add_runner(props("front", Strategy::FrontRunner));
        race.add_runner(props("pace", Strategy::PaceChaser));
        race.prepare_round(7);

        let snapshot = build_field_snapshot(
            &mut race.runners,
            &race.finished_runners,
            &mut race.order_tracker,
        );

        // The caster emits a nige-targeting Current Speed debuff this frame.
        race.runners[0].emitted_debuffs.push(EmittedDebuff {
            skill_id: SkillId::new("200851"),
            effect: ResolvedSkillEffect {
                target: SkillTarget::EnemyStrategy,
                effect_type: SkillType::CurrentSpeed,
                base_duration: 3.0,
                modifier: -0.15,
            },
            target: SkillTarget::EnemyStrategy,
            target_strategy: Some(Strategy::FrontRunner),
        });

        race.coordinate_external_debuffs(&snapshot);

        // The front runner is debuffed; caster and pace chaser are untouched.
        assert_eq!(race.runners[1].targeted_current_speed_active.len(), 1);
        assert!(race.runners[1].modifiers.current_speed.total() < 0.0);
        assert!(race.runners[0].targeted_current_speed_active.is_empty());
        assert!(race.runners[2].targeted_current_speed_active.is_empty());
        // The emitter's outbox is drained.
        assert!(race.runners[0].emitted_debuffs.is_empty());
        // The victim logged the received debuff.
        assert_eq!(race.runners[1].used_targeted_skills.len(), 1);
        assert_eq!(
            race.runners[1].used_targeted_skills[0].skill_id.as_str(),
            "200851"
        );
    }

    #[test]
    fn external_debuff_skips_same_team_targets() {
        use uma_sim_primitives::race_support::build_field_snapshot;
        use uma_sim_primitives::shared_kernel::ids::SkillId;
        use uma_sim_primitives::skills::effect::{SkillTarget, SkillType};
        use uma_sim_primitives::skills::model::{EmittedDebuff, ResolvedSkillEffect};

        // R0 caster (team 1), R1 Front Runner teammate (team 1), R2 Front
        // Runner opponent (team 2), R3 Front Runner without a team.
        let mut race = Race::new(
            test_course(),
            GroundCondition::Firm,
            SimulationSettings::default(),
            test_race_params(),
        );
        let mut caster = props("caster", Strategy::LateSurger);
        caster.team = Some(1);
        let mut teammate = props("teammate", Strategy::FrontRunner);
        teammate.team = Some(1);
        let mut opponent = props("opponent", Strategy::FrontRunner);
        opponent.team = Some(2);
        let teamless = props("teamless", Strategy::FrontRunner);
        race.add_runner(caster);
        race.add_runner(teammate);
        race.add_runner(opponent);
        race.add_runner(teamless);
        race.prepare_round(7);
        let routed_targets = Rc::new(RefCell::new(Vec::new()));
        race.subscribe(Box::new(RoutedDebuffObserver {
            targets: Rc::clone(&routed_targets),
        }));

        let snapshot = build_field_snapshot(
            &mut race.runners,
            &race.finished_runners,
            &mut race.order_tracker,
        );

        race.runners[0].emitted_debuffs.push(EmittedDebuff {
            skill_id: SkillId::new("200851"),
            effect: ResolvedSkillEffect {
                target: SkillTarget::EnemyStrategy,
                effect_type: SkillType::CurrentSpeed,
                base_duration: 3.0,
                modifier: -0.15,
            },
            target: SkillTarget::EnemyStrategy,
            target_strategy: Some(Strategy::FrontRunner),
        });

        race.coordinate_external_debuffs(&snapshot);

        // Teammates are excluded from the effect of debuffs (mechanics § Skill
        // Target): the same-team front runner is untouched, while the enemy
        // team and teamless front runners are both hit.
        assert!(race.runners[1].targeted_current_speed_active.is_empty());
        assert!(race.runners[1].used_targeted_skills.is_empty());
        assert_eq!(race.runners[2].targeted_current_speed_active.len(), 1);
        assert!(race.runners[2].modifiers.current_speed.total() < 0.0);
        assert_eq!(race.runners[3].targeted_current_speed_active.len(), 1);
        assert!(race.runners[3].modifiers.current_speed.total() < 0.0);
        // The replay mask means "affected", so the skipped teammate is absent.
        assert_eq!(*routed_targets.borrow(), vec![RunnerId(2), RunnerId(3)]);
    }

    #[test]
    fn frenzied_extends_only_rushed_matching_strategy_opponents() {
        use uma_sim_primitives::race_support::build_field_snapshot;
        use uma_sim_primitives::shared_kernel::ids::SkillId;
        use uma_sim_primitives::skills::effect::{SkillTarget, SkillType};
        use uma_sim_primitives::skills::model::{EmittedDebuff, ResolvedSkillEffect};

        // R0 caster (Pace Chaser), R1 Front Runner (rushed target), R2 Front
        // Runner (not rushed), R3 Pace Chaser (wrong style, rushed).
        let mut race = Race::new(
            test_course(),
            GroundCondition::Firm,
            SimulationSettings::default(),
            test_race_params(),
        );
        race.add_runner(props("caster", Strategy::PaceChaser));
        race.add_runner(props("rushed-front", Strategy::FrontRunner));
        race.add_runner(props("calm-front", Strategy::FrontRunner));
        race.add_runner(props("rushed-pace", Strategy::PaceChaser));
        race.prepare_round(11);

        // Put two runners into the rushed state with the default 12s cap.
        for idx in [1usize, 3] {
            race.runners[idx].is_rushed = true;
            race.runners[idx].rushed_max_duration = 12.0;
        }
        race.runners[2].is_rushed = false;
        race.runners[2].rushed_max_duration = 12.0;

        let snapshot = build_field_snapshot(
            &mut race.runners,
            &race.finished_runners,
            &mut race.order_tracker,
        );

        // Frenzied Front Runners (200791): +5.0s to the rushed timer of the
        // Front Runner enemy strategy.
        race.runners[0].emitted_debuffs.push(EmittedDebuff {
            skill_id: SkillId::new("200791"),
            effect: ResolvedSkillEffect {
                target: SkillTarget::KakariStrategy,
                effect_type: SkillType::RushedDuration,
                base_duration: 0.0,
                modifier: 5.0,
            },
            target: SkillTarget::KakariStrategy,
            target_strategy: Some(Strategy::FrontRunner),
        });

        race.coordinate_external_debuffs(&snapshot);

        // Rushed Front Runner: timer extended by 5s (12 -> 17).
        assert!((race.runners[1].rushed_max_duration - 17.0).abs() < 1e-9);
        // Non-rushed Front Runner: routed to, but the receiver no-ops.
        assert!((race.runners[2].rushed_max_duration - 12.0).abs() < 1e-9);
        // Rushed Pace Chaser: wrong style, not a target.
        assert!((race.runners[3].rushed_max_duration - 12.0).abs() < 1e-9);
        // Caster is never self-targeted.
        assert!((race.runners[0].rushed_max_duration - 12.0).abs() < 1e-9);
        // Emitter outbox drained.
        assert!(race.runners[0].emitted_debuffs.is_empty());
    }

    #[test]
    fn finished_runners_keep_their_place_in_the_order_map() {
        use uma_sim_primitives::race_support::{build_field_snapshot, build_field_view};

        let mut race = pace_chaser_race(3);
        race.prepare_round(99);

        // Lay the field out on course: R2 ahead, R1 middle, R0 behind.
        race.runners[0].position = 1000.0;
        race.runners[1].position = 1500.0;
        race.runners[2].position = 2000.0;

        // The two leaders cross the line; only R0 is still racing.
        race.finished_runners = vec![RunnerId(2), RunnerId(1)];

        let snapshot = build_field_snapshot(
            &mut race.runners,
            &race.finished_runners,
            &mut race.order_tracker,
        );

        // Finished runners hold places 1 and 2 (in finish order); the lone active
        // runner is ranked last, not promoted to "order 1".
        assert_eq!(snapshot.order.get(&RunnerId(2)).copied(), Some(1));
        assert_eq!(snapshot.order.get(&RunnerId(1)).copied(), Some(2));
        assert_eq!(snapshot.order.get(&RunnerId(0)).copied(), Some(3));
        assert_eq!(snapshot.num_active, 1);
        assert_eq!(snapshot.num_total, 3);

        // The trailing runner's field view reports last place over the full field.
        let view = build_field_view(RunnerId(0), &snapshot);
        assert_eq!(view.self_order, Some(3));
        assert_eq!(view.num_umas, 3);
    }

    #[test]
    fn proximity_dueling_arms_then_starts_for_bunched_leaders() {
        let mut race = pace_chaser_race(4);
        race.prepare_round(99);
        // Give the course a final straight covering the cluster.
        race.course.straights = vec![uma_sim_primitives::course::model::Straight {
            start: 2000.0,
            end: 2400.0,
            front_type: 0,
        }];
        // Bunch runners 0 and 1 together on the final straight.
        for (idx, runner) in race.runners.iter_mut().enumerate() {
            runner.is_dueling = false;
            runner.can_duel = None;
            if idx < 2 {
                runner.position = 2300.0;
                runner.current_lane = 0.5;
                runner.current_speed = 18.0;
            } else {
                runner.position = 2100.0;
                runner.current_lane = 0.5;
                runner.current_speed = 18.0;
            }
        }
        // Order map: 0 and 1 are the top half (cutoff = ceil(4/2) = 2).
        race.order_tracker.runner_order = [
            (RunnerId(0), 1),
            (RunnerId(1), 2),
            (RunnerId(2), 3),
            (RunnerId(3), 4),
        ]
        .into_iter()
        .collect();

        race.coordinate_proximity_dueling();
        // The 2s window arms on PROXIMITY alone - every bunched pair arms,
        // regardless of placement (rank is a trigger-frame check).
        assert_eq!(race.runners[0].can_duel, Some(true));
        assert_eq!(race.runners[1].can_duel, Some(true));
        assert_eq!(race.runners[2].can_duel, Some(true));

        // After the 2s proximity window, the top-half pair starts dueling...
        race.runners[0].dueling_timer.t = 2.0;
        race.runners[2].dueling_timer.t = 2.0;
        race.coordinate_proximity_dueling();
        assert!(race.runners[0].is_dueling);
        assert_eq!(race.runners[0].dueling_start_position, 2300.0);
        // ...but the all-bottom-half pair cannot: neither is a valid target
        // (at least one of the pair must be in the top 50%).
        assert!(!race.runners[2].is_dueling);
        assert!(!race.runners[3].is_dueling);
    }

    #[test]
    fn spot_struggle_group_activates_bunched_front_runners() {
        let mut race = pace_chaser_race(3);
        race.prepare_round(42);
        // Force front-runner position-keep so they qualify as triggers, and bunch
        // two of them inside the early-race spot-struggle section.
        let section = race.runners[0].section_length;
        let in_section_pos = (section * 4.0).min((section * 5.0).floor()).max(200.0);
        for (idx, runner) in race.runners.iter_mut().enumerate() {
            runner.strategy = Strategy::FrontRunner;
            runner.position_keep_strategy = Strategy::FrontRunner;
            runner.in_spot_struggle = false;
            runner.spot_struggle_start_position = None;
            if idx < 2 {
                runner.position = in_section_pos;
                runner.current_lane = 0.5;
            } else {
                // Trailing beyond the 3.75m entry gap behind the frontmost.
                runner.position = in_section_pos - 50.0;
                runner.current_lane = 0.5;
            }
        }

        race.coordinate_spot_struggle_groups();
        assert!(race.runners[0].in_spot_struggle);
        assert!(race.runners[1].in_spot_struggle);
        assert!(race.runners[0].spot_struggle_start_position.is_some());
        // Spot struggle ends at section 9 (absolute), not start + 8 sections.
        let section9 = (section * 8.0).floor();
        assert_eq!(race.runners[0].spot_struggle_end_position, section9);
        // The trailing runner is outside the entry distance and stays out.
        assert!(!race.runners[2].in_spot_struggle);

        // Each style triggers only once per race: the trailing runner cannot
        // start a second FrontRunner spot struggle later, even if bunched.
        race.runners[2].position = in_section_pos;
        race.coordinate_spot_struggle_groups();
        assert!(!race.runners[2].in_spot_struggle);
    }

    #[test]
    fn spot_struggle_distance_exit_and_cascade() {
        let mut race = pace_chaser_race(3);
        race.prepare_round(7);
        let section9 = (race.runners[0].section_length * 8.0).floor();
        for runner in &mut race.runners {
            runner.strategy = Strategy::FrontRunner;
            runner.in_spot_struggle = true;
            runner.spot_struggle_start_position = Some(200.0);
            runner.spot_struggle_end_position = section9;
            runner.spot_struggle_distance_exited = false;
            runner.position = 250.0;
            runner.current_lane = 0.5;
        }
        // Runner 2 falls >=5m behind BOTH active strugglers -> distance exit.
        race.runners[2].position = 244.0;
        race.coordinate_spot_struggle_exits();
        assert!(race.runners[0].in_spot_struggle);
        assert!(race.runners[1].in_spot_struggle);
        assert!(!race.runners[2].in_spot_struggle);
        assert!(race.runners[2].spot_struggle_distance_exited);

        // Runner 1 falls behind runner 0 -> distance exit; runner 0 is then the
        // last active struggler and every other participant distance-exited, so
        // the cascade removes her too.
        race.runners[1].position = 244.5;
        race.coordinate_spot_struggle_exits();
        assert!(!race.runners[1].in_spot_struggle);
        assert!(race.runners[0].in_spot_struggle);
        race.coordinate_spot_struggle_exits();
        assert!(!race.runners[0].in_spot_struggle);
    }

    #[test]
    fn spot_struggle_natural_expiry_does_not_cascade() {
        let mut race = pace_chaser_race(2);
        race.prepare_round(7);
        let section9 = (race.runners[0].section_length * 8.0).floor();
        for runner in &mut race.runners {
            runner.strategy = Strategy::FrontRunner;
            runner.spot_struggle_start_position = Some(200.0);
            runner.spot_struggle_end_position = section9;
            runner.position = 250.0;
            runner.current_lane = 0.5;
        }
        // Runner 1 already expired naturally (not a distance exit).
        race.runners[0].in_spot_struggle = true;
        race.runners[1].in_spot_struggle = false;
        race.runners[1].spot_struggle_distance_exited = false;
        race.coordinate_spot_struggle_exits();
        // No cascade: the remaining struggler keeps going on her own duration.
        assert!(race.runners[0].in_spot_struggle);
    }

    #[test]
    fn spot_struggle_unlocks_for_field_when_any_runner_passes_150m() {
        let mut race = pace_chaser_race(3);
        race.prepare_round(7);
        for (idx, runner) in race.runners.iter_mut().enumerate() {
            runner.strategy = Strategy::FrontRunner;
            runner.position_keep_strategy = Strategy::FrontRunner;
            runner.in_spot_struggle = false;
            runner.spot_struggle_start_position = None;
            runner.current_lane = 0.5;
            // Bunched pair below 150m; a third (any style) ahead of 150m.
            runner.position = if idx < 2 { 140.0 } else { 400.0 };
        }
        race.runners[2].strategy = Strategy::PaceChaser;
        race.coordinate_spot_struggle_groups();
        // The pair triggers even though neither has passed 150m herself.
        assert!(race.runners[0].in_spot_struggle);
        assert!(race.runners[1].in_spot_struggle);
    }

    #[test]
    fn dueling_distance_exit_and_former_participants() {
        let mut race = pace_chaser_race(4);
        race.prepare_round(7);
        race.course.straights = vec![uma_sim_primitives::course::model::Straight {
            start: 2000.0,
            end: 2400.0,
            front_type: 0,
        }];
        race.order_tracker.runner_order = [
            (RunnerId(0), 1),
            (RunnerId(1), 2),
            (RunnerId(2), 3),
            (RunnerId(3), 4),
        ]
        .into_iter()
        .collect();
        for runner in &mut race.runners {
            runner.position = 2300.0;
            runner.current_lane = 0.5;
            runner.current_speed = 18.0;
            runner.is_dueling = false;
            runner.has_dueled = false;
            runner.can_duel = None;
        }
        race.runners[0].is_dueling = true;
        race.runners[1].is_dueling = true;

        // Bunched: nobody exits.
        race.coordinate_proximity_dueling();
        assert!(race.runners[0].is_dueling);

        // Runner 0 pulls >=5m ahead of every current/former participant.
        race.runners[0].position = 2306.0;
        race.coordinate_proximity_dueling();
        assert!(!race.runners[0].is_dueling);
        assert!(race.runners[0].has_dueled);
        // Runner 1 keeps dueling: former participant 0 is within 5m again once
        // positions close, and 1 was never separated from everyone.
        // (0 at 2306 vs 1 at 2300 -> gap 6m: 1 has no other current/former
        // participant within 5m, so she exits too.)
        assert!(!race.runners[1].is_dueling);
        assert!(race.runners[1].has_dueled);

        // Former duelers cannot rejoin: bunch everyone again, arm, and elapse
        // the window - 0 and 1 stay out while 2 and 3 cannot duel either
        // (bottom-half pair), leaving no new duels.
        race.runners[0].position = 2300.0;
        race.coordinate_proximity_dueling();
        assert_eq!(race.runners[0].can_duel, None);
        assert!(!race.runners[0].is_dueling);
    }

    #[test]
    fn dueling_window_arms_before_initiator_reaches_final_straight() {
        let mut race = pace_chaser_race(2);
        race.prepare_round(7);
        race.course.straights = vec![uma_sim_primitives::course::model::Straight {
            start: 2000.0,
            end: 2400.0,
            front_type: 0,
        }];
        race.order_tracker.runner_order =
            [(RunnerId(0), 1), (RunnerId(1), 2)].into_iter().collect();
        for runner in &mut race.runners {
            runner.current_lane = 0.5;
            runner.current_speed = 18.0;
            runner.is_dueling = false;
            runner.has_dueled = false;
            runner.can_duel = None;
        }
        // Initiator still in the corner; TARGET already on the straight,
        // within 3m (replay evidence: the 2s window is anchored to the
        // target's presence on the straight, not the initiator's).
        race.runners[0].position = 1998.5;
        race.runners[1].position = 2001.0;

        race.coordinate_proximity_dueling();
        assert_eq!(race.runners[0].can_duel, Some(true));

        // Window elapsed but the initiator has not reached the straight yet:
        // no duel on this frame.
        race.runners[0].dueling_timer.t = 2.0;
        race.coordinate_proximity_dueling();
        assert!(!race.runners[0].is_dueling);

        // The initiator reaches the straight: the duel fires immediately
        // (trigger conditions only need one frame).
        race.runners[0].position = 2001.0;
        race.runners[1].position = 2003.5;
        race.coordinate_proximity_dueling();
        assert!(race.runners[0].is_dueling);
    }

    #[test]
    fn dueling_former_participant_keeps_duel_alive() {
        let mut race = pace_chaser_race(3);
        race.prepare_round(7);
        race.course.straights = vec![uma_sim_primitives::course::model::Straight {
            start: 2000.0,
            end: 2400.0,
            front_type: 0,
        }];
        race.order_tracker.runner_order = [(RunnerId(0), 1), (RunnerId(1), 2), (RunnerId(2), 3)]
            .into_iter()
            .collect();
        for runner in &mut race.runners {
            runner.position = 2300.0;
            runner.current_lane = 0.5;
            runner.current_speed = 18.0;
            runner.is_dueling = false;
            runner.has_dueled = false;
            runner.can_duel = None;
        }
        // Runner 0 actively duels; runner 1 is a FORMER participant nearby;
        // runner 2 far away.
        race.runners[0].is_dueling = true;
        race.runners[1].has_dueled = true;
        race.runners[2].position = 2200.0;

        race.coordinate_proximity_dueling();
        // The former participant within 5m keeps the duel alive.
        assert!(race.runners[0].is_dueling);

        // Once the former participant is also >=5m away, the last active
        // dueler exits.
        race.runners[1].position = 2294.0;
        race.coordinate_proximity_dueling();
        assert!(!race.runners[0].is_dueling);
    }

    #[test]
    fn different_seed_may_differ_but_all_finish() {
        let mut race = race_with(9);
        race.prepare_round(2024);
        race.run();
        assert_eq!(race.finished_runners().len(), 9);
        // Gates are a unique permutation of 0..9.
        let mut gates: Vec<i64> = race.runners().iter().map(|r| r.gate).collect();
        gates.sort_unstable();
        gates.dedup();
        assert_eq!(gates.len(), 9);
    }
}
