//! The `Race` **aggregate root** (port of `common/race.ts`).
//!
//! Owns the field of [`Runner`]s and is the only thing that mutates them. The
//! tick loop is **snapshot-based** (see `.plans/.../context.md`): each frame
//! builds one immutable [`crate::race_support::FieldSnapshot`] from the *current* state, then steps
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
    assign_gates, build_field_snapshot, build_field_view, condition_value, resolve_debuff_targets,
    FieldOrderTracker,
};
use uma_sim_primitives::runner::lifecycle::{CreateRunner, PrepareContext};
use uma_sim_primitives::runner::mechanics::DuelingRates;
use uma_sim_primitives::runner::physics::{
    update_first_position_in_late_race, DuelingInput, FieldInputs, SkillTriggerInputs,
    UpdateContext,
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
    /// the default; unlisted runners (such as a pacer) use `rushed`.
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
    /// override the default; unlisted runners use `wit_checks`.
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
    /// Per-strategy dueling rates (compare-mode artificial dueling).
    pub dueling_rates: Option<DuelingRates>,

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
        dueling_rates: Option<DuelingRates>,
    ) -> Self {
        register_all_dynamic_conditions();
        let mut whole_course = RegionList::new();
        whole_course.push(Region::new(0.0, course.distance));
        Race {
            ground,
            settings,
            race_params,
            dueling_rates,
            runners: Vec::new(),
            finished_runners: Vec::new(),
            catalog: build_catalog(),
            whole_course,
            round_iteration: 0,
            accumulated_time: 0.0,
            seed: 0,
            rng: Box::new(Xoshiro256StarStar::from_u64_seed(0)),
            order_tracker: FieldOrderTracker::new(),
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

        self.prepare_race();

        self.seed = master_seed;
        self.rng = Box::new(Xoshiro256StarStar::from_u64_seed(master_seed));

        let base_speed = self.base_speed();
        let parser = ConditionParser::new(&self.catalog);

        // The vacuum field always draws from 9 gates, whatever its size.
        let fixed_gates: Vec<Option<i64>> = self.runners.iter().map(|r| r.fixed_gate).collect();
        let gates = assign_gates(&fixed_gates, 9, &mut *self.rng);

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
                // Synthetic engine: static approximate regions + the ×10
                // position-keep window (ADR-0005, no paradigm branch).
                condition_resolution: ConditionResolution::Static,
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
    }

    /// Reset per-round race params for the vacuum field: the synthetic engine
    /// does not fold in field composition (no live field to count), so the
    /// strategy-count / common-skill aggregates are cleared.
    ///
    /// A caller-supplied `num_umas` is the *assumed* field the order bands
    /// describe, so it wins over the vacuum field's real size (typically a
    /// single runner). Overwriting it would judge a nine-runner band against a
    /// field of one and reject the band as an invalid range.
    fn prepare_race(&mut self) {
        self.race_params
            .num_umas
            .get_or_insert(self.runners.len() as u32);
        self.race_params.strategy_counts = None;
        self.race_params.common_skills = None;
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
            // input from **approximate condition values + synthetic dueling
            // rates** (ADR-0005 synthetic producer) and hands the step a pure
            // `FieldInputs` plus a field-free course context. There is no
            // paradigm branch and no live field to read.
            let field_inputs =
                resolve_field_inputs(runner, &field, self.dueling_rates, position_keep);
            let ctx = UpdateContext {
                base_speed,
                accumulated_time: self.accumulated_time,
                course: &self.course,
            };
            runner.on_update(dt, &field_inputs, &ctx);
        }
        self.runners = runners;

        // Route opponent-facing debuffs emitted this frame onto their targets.
        // With context runners in the vacuum race (e.g. a dedicated pacer) there
        // IS a field to hit: the pacer's Hesitant-family / Speed Eater casts land
        // on the compared uma exactly as in the contested engine. In a solo
        // vacuum the resolver finds no targets and this reduces to draining the
        // outbox (the old behavior). Proximity dueling / spot-struggle stay
        // synthetic — those contention coordinators remain contested-only.
        self.coordinate_external_debuffs(&snapshot);

        update_first_position_in_late_race(&mut self.runners, self.course.distance);

        self.emit_runner_ticks_and_finishes(dt);
    }

    /// **External-debuff routing** coordinator (port of the contested engine's
    /// pass). Drains every runner's per-frame emitted-debuff outbox and applies
    /// each effect onto the resolved target runners through the existing
    /// targeted-effect path ([`Runner::receive_targeted_effect`]). The caster
    /// never receives its own external effect; finished runners (absent from
    /// the snapshot) are not hit.
    ///
    /// Determinism: outboxes are drained in ascending `RunnerId` order and
    /// targets are resolved from the frozen frame snapshot. Effect modifiers
    /// add commutatively, so multiple sources debuffing one target in a frame
    /// yield an order-independent result.
    fn coordinate_external_debuffs(
        &mut self,
        snapshot: &uma_sim_primitives::race_support::FieldSnapshot,
    ) {
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

/// Resolve the [`FieldInputs`] for one runner this tick, from **approximate
/// condition values + synthetic dueling rates** (ADR-0005 synthetic producer).
///
/// There is no live field: side-block / overtake are read from the runner's
/// pre-resolved approximate conditions, and dueling is the artificial roll
/// driven by the per-strategy [`DuelingRates`] (which may be absent). The step
/// never sees how these were produced.
fn resolve_field_inputs<'a>(
    runner: &Runner,
    field: &'a FieldView,
    dueling_rates: Option<DuelingRates>,
    position_keep: PositionKeepContext,
) -> FieldInputs<'a> {
    FieldInputs {
        side_blocked: condition_value(runner, "blocked_side") == 1,
        front_blocker: None,
        overtaking: condition_value(runner, "overtake") == 1,
        dueling: DuelingInput::Artificial(dueling_rates),
        position_keep,
        skill_triggers: SkillTriggerInputs { field },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use uma_sim_primitives::runner::lifecycle::RunnerAptitudes;
    use uma_sim_primitives::runner::test_support::{test_course, test_race_params};
    use uma_sim_primitives::shared_kernel::language::{Aptitude, Mood, Strategy};
    use uma_sim_primitives::shared_kernel::params::StatLine;

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
            forced_rank: vec![],
            gate: None,
            forced_start_delay: None,
        }
    }

    fn race_with(n: u32) -> Race {
        let mut race = Race::new(
            test_course(),
            GroundCondition::Firm,
            SimulationSettings::default(),
            test_race_params(),
            None,
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
    fn per_runner_settings_override_the_race_default() {
        let settings = SimulationSettings {
            rushed: true,
            rushed_runners: vec![true, false],
            downhill_runners: vec![false, true],
            conserve_power_runners: vec![true, false],
            wit_checks_runners: vec![false, true],
            ..SimulationSettings::default()
        };
        let mut race = Race::new(
            test_course(),
            GroundCondition::Firm,
            settings,
            test_race_params(),
            None,
        );
        race.add_runner(props("a", Strategy::PaceChaser));
        race.add_runner(props("b", Strategy::PaceChaser));
        race.add_runner(props("pacer", Strategy::FrontRunner));
        race.prepare_round(42);

        assert!(race.runners[0].rushed_enabled);
        assert!(!race.runners[1].rushed_enabled);
        assert!(!race.runners[0].downhill_enabled);
        assert!(race.runners[1].downhill_enabled);
        assert!(race.runners[0].conserve_power_enabled);
        assert!(!race.runners[1].conserve_power_enabled);
        assert!(!race.runners[0].wit_checks_enabled);
        assert!(race.runners[1].wit_checks_enabled);
        // Unlisted runners fall back to the race defaults.
        assert!(race.runners[2].rushed_enabled);
        assert!(race.runners[2].downhill_enabled);
        assert!(race.runners[2].conserve_power_enabled);
        assert!(race.runners[2].wit_checks_enabled);
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

    #[test]
    fn external_debuff_routes_to_matching_strategy_not_self() {
        use uma_sim_primitives::race_support::build_field_snapshot;
        use uma_sim_primitives::shared_kernel::ids::SkillId;
        use uma_sim_primitives::skills::effect::{SkillTarget, SkillType};
        use uma_sim_primitives::skills::model::{EmittedDebuff, ResolvedSkillEffect};

        // R0 primary (Front Runner, target), R1 context caster (Late Surger),
        // R2 context Pace Chaser — a vacuum race with a debuffing pacer field.
        let mut race = Race::new(
            test_course(),
            GroundCondition::Firm,
            SimulationSettings::default(),
            test_race_params(),
            None,
        );
        race.add_runner(props("primary", Strategy::FrontRunner));
        race.add_runner(props("caster", Strategy::LateSurger));
        race.add_runner(props("pace", Strategy::PaceChaser));
        race.prepare_round(7);

        let snapshot = build_field_snapshot(
            &mut race.runners,
            &race.finished_runners,
            &mut race.order_tracker,
        );

        // The context caster emits a nige-targeting Current Speed debuff.
        race.runners[1].emitted_debuffs.push(EmittedDebuff {
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

        // The primary front runner is debuffed; caster and pace chaser are not.
        assert_eq!(race.runners[0].targeted_current_speed_active.len(), 1);
        assert!(race.runners[0].modifiers.current_speed.total() < 0.0);
        assert!(race.runners[1].targeted_current_speed_active.is_empty());
        assert!(race.runners[2].targeted_current_speed_active.is_empty());
        // The emitter's outbox is drained.
        assert!(race.runners[1].emitted_debuffs.is_empty());
        // The victim logged the received debuff.
        assert_eq!(race.runners[0].used_targeted_skills.len(), 1);
        assert_eq!(
            race.runners[0].used_targeted_skills[0].skill_id.as_str(),
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
        // Runner opponent (team 2).
        let mut race = Race::new(
            test_course(),
            GroundCondition::Firm,
            SimulationSettings::default(),
            test_race_params(),
            None,
        );
        let mut caster = props("caster", Strategy::LateSurger);
        caster.team = Some(1);
        let mut teammate = props("teammate", Strategy::FrontRunner);
        teammate.team = Some(1);
        let mut opponent = props("opponent", Strategy::FrontRunner);
        opponent.team = Some(2);
        race.add_runner(caster);
        race.add_runner(teammate);
        race.add_runner(opponent);
        race.prepare_round(7);

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

        // The teammate is spared; the opponent is hit.
        assert!(race.runners[1].targeted_current_speed_active.is_empty());
        assert_eq!(race.runners[2].targeted_current_speed_active.len(), 1);
    }

    #[test]
    fn solo_vacuum_drains_emitted_debuffs_without_targets() {
        use uma_sim_primitives::race_support::build_field_snapshot;
        use uma_sim_primitives::shared_kernel::ids::SkillId;
        use uma_sim_primitives::skills::effect::{SkillTarget, SkillType};
        use uma_sim_primitives::skills::model::{EmittedDebuff, ResolvedSkillEffect};

        let mut race = Race::new(
            test_course(),
            GroundCondition::Firm,
            SimulationSettings::default(),
            test_race_params(),
            None,
        );
        race.add_runner(props("solo", Strategy::FrontRunner));
        race.prepare_round(7);

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

        // No field to hit: the outbox drains, the caster is never self-targeted.
        assert!(race.runners[0].emitted_debuffs.is_empty());
        assert!(race.runners[0].targeted_current_speed_active.is_empty());
    }
}
