//! Runner construction and the per-round `on_prepare` reset + initializers.
//!
//! Ports the `Runner` constructor, `Runner.create`, and the `onPrepare` reset
//! chain from `common/runner.ts`. The reset is split so a runner instance can be
//! reused across rounds.
//!
//! ## Scope (t-013)
//!
//! This task owns the entity definition, stat building, and the *deterministic
//! field-reset* initializers (RNG sub-streams, position keeping, kinematics,
//! stamina-policy init). The formula-heavy initializers — speed calculations
//! (t-014), skill-data building (t-015), and the rushed/dueling/spot-struggle/
//! downhill/hills mechanics (t-016) — are wired into `on_prepare` by their owning
//! tasks at the marked seams. `on_prepare` takes a [`RoundContext`] instead of a
//! `&Race` back-pointer (the aggregate builds it in t-017).

use std::collections::HashMap;

use crate::course::model::CourseData;
use crate::position_keep::initialize_position_keep;
use crate::runner::{ForcedRank, ForcedRegion, InjectedDebuff, Runner};
use crate::shared_kernel::ids::RunnerId;
use crate::shared_kernel::language::{Aptitude, GroundCondition, Mood, Phase, Strategy};
use crate::shared_kernel::math::Timer;
use crate::shared_kernel::params::{RaceParameters, StatLine};
use crate::shared_kernel::region::RegionList;
use crate::shared_kernel::rng::{Prng, Xoshiro256StarStar};
use crate::skills::condition::language::ConditionParser;
use crate::skills::condition::ConditionResolution;
use crate::skills::effect::PositionKeepState;
use crate::skills::model::Skill;
use crate::stamina::policy::{StaminaPolicy, StaminaStats};

use super::physics::SpeedModifiers;
use super::stats::{build_adjusted_stats, build_base_stats};

/// Number of course sections (used to derive section length).
const SECTION_COUNT: f64 = 24.0;

/// A runner's distance / strategy / surface aptitudes.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RunnerAptitudes {
    /// Distance aptitude.
    pub distance: Aptitude,
    /// Running-style aptitude (drives the wit adjustment).
    pub strategy: Aptitude,
    /// Surface aptitude.
    pub surface: Aptitude,
}

/// Input DTO describing a runner to add to a race. `name` and `skills` are
/// pre-resolved by the caller (decoupling the core from display-info / skill
/// data services).
#[derive(Debug, Clone, PartialEq)]
pub struct CreateRunner {
    /// Outfit (costume) id.
    pub outfit_id: String,
    /// Pre-resolved display name.
    pub name: String,
    /// Motivation.
    pub mood: Mood,
    /// Running style.
    pub strategy: Strategy,
    /// Betting popularity rank (1 = most popular). `0` means unknown/unset.
    pub popularity: i64,
    /// CM/LoH team grouping (1-based). `None` = no team. Teammates can trigger
    /// and be targeted by skills, but are excluded from the *effect* of
    /// external debuffs (mechanics § Skill Target).
    pub team: Option<i32>,
    /// Aptitudes.
    pub aptitudes: RunnerAptitudes,
    /// Raw input stats.
    pub stats: StatLine,
    /// Pre-resolved skills.
    pub skills: Vec<Skill>,
    /// Skill-base-id -> forced activation position.
    pub forced_positions: HashMap<String, f64>,
    /// Injected debuffs (compare mode).
    pub injected_debuffs: Vec<InjectedDebuff>,
    /// Scripted rushed regions.
    pub forced_rushed_regions: Vec<ForcedRegion>,
    /// Scripted dueling regions.
    pub forced_dueling_regions: Vec<ForcedRegion>,
    /// Scripted spot-struggle regions.
    pub forced_spot_struggle_regions: Vec<ForcedRegion>,
    /// Scripted forced-rank regions.
    pub forced_rank: Vec<ForcedRank>,
}

/// The race-derived inputs `on_prepare` needs without a `&Race` back-pointer.
/// Built by the aggregate each round (t-017). Carries the static skill-build
/// context (parser/catalog, whole-course regions, race params, sample budget).
pub struct PrepareContext<'a> {
    /// The course being raced.
    pub course: &'a CourseData,
    /// Course base speed (`20 - (distance - 2000) / 1000`).
    pub base_speed: f64,
    /// Engine-supplied condition-resolution strategy (dynamic vs static).
    /// The contested engine resolves live dynamic predicates; the synthetic
    /// engine resolves static approximate regions.
    pub condition_resolution: ConditionResolution,
    /// Engine-supplied position-keep window multiplier (×10 = sections 1–10 per
    /// mechanics § Position Keeping) applied to the section length to derive
    /// `pos_keep_end`.
    pub pos_keep_end_multiplier: f64,
    /// Race-wide parameters read by static skill conditions.
    pub race_params: &'a RaceParameters,
    /// The whole course as a region list (`[0, distance)`).
    pub whole_course: &'a RegionList,
    /// The condition parser (bound to the static catalog).
    pub parser: &'a ConditionParser<'a>,
    /// Number of activation samples drawn per skill trigger.
    pub skill_samples: usize,
    /// The round index (selects which sample fires).
    pub round_iteration: usize,
}

/// Derive the character id from an outfit id (the first four characters).
fn uma_id_from_outfit(outfit_id: &str) -> String {
    outfit_id.chars().take(4).collect()
}

impl Runner {
    /// Build a runner from its input DTO, deriving base + adjusted stats for the
    /// given course/ground. Runtime state is placeholder until
    /// [`on_prepare`](Runner::on_prepare) resets it for a round.
    pub fn create(
        id: RunnerId,
        course: &CourseData,
        ground: GroundCondition,
        props: CreateRunner,
        health_policy: Box<dyn StaminaPolicy>,
        rng: Box<dyn Prng>,
    ) -> Runner {
        let base_stats = build_base_stats(&props.stats, props.mood);
        let adjusted_stats =
            build_adjusted_stats(&base_stats, course, ground, props.aptitudes.strategy);

        let placeholder_rng =
            || -> Box<dyn Prng> { Box::new(Xoshiro256StarStar::from_u32_seed(0)) };

        Runner {
            id,
            uma_id: uma_id_from_outfit(&props.outfit_id),
            outfit_id: props.outfit_id,
            name: props.name,
            strategy: props.strategy,
            position_keep_strategy: props.strategy,
            mood: props.mood,
            popularity: props.popularity,
            team: props.team,
            aptitudes: props.aptitudes,
            stats: props.stats,
            base_stats,
            adjusted_stats,
            pristine_base_stats: base_stats,
            pristine_adjusted_stats: adjusted_stats,
            skills: props.skills,
            forced_positions: props.forced_positions,
            injected_debuffs: props.injected_debuffs,
            forced_rushed_regions: props.forced_rushed_regions,
            forced_dueling_regions: props.forced_dueling_regions,
            forced_spot_struggle_regions: props.forced_spot_struggle_regions,
            forced_rank: props.forced_rank,
            health_policy,
            rng,
            rushed_rng: placeholder_rng(),
            wit_rng: placeholder_rng(),
            downhill_rng: placeholder_rng(),
            lane_movement_rng: placeholder_rng(),
            skill_rng: placeholder_rng(),
            force_skill_activator_rng: placeholder_rng(),
            dueling_rng: placeholder_rng(),
            sync_rng: placeholder_rng(),
            random_lot: 0,
            position: 0.0,
            current_speed: 0.0,
            target_speed: 0.0,
            min_speed: 0.0,
            acceleration: 0.0,
            force_in_speed: 0.0,
            section_length: course.distance / SECTION_COUNT,
            base_accelerations: [0.0; 6],
            base_target_speed_per_phase: [0.0; 3],
            modifiers: SpeedModifiers::zeroed(),
            section_modifiers: Vec::new(),
            accumulate_time: Timer::new(-1.0),
            condition_timer: Timer::new(-1.0),
            phase: Phase::EarlyRace,
            next_phase_transition: 0.0,
            start_dash: true,
            gate: 0,
            start_delay: 0.0,
            start_delay_accumulator: 0.0,
            finished: false,
            finish_time: 0.0,
            current_lane: 0.0,
            target_lane: 0.0,
            extra_move_lane: -1.0,
            lane_change_speed: 0.0,
            is_side_blocked: false,
            is_overtaking: false,
            first_position_in_late_race: false,
            hills: Vec::new(),
            current_hill_index: -1,
            next_hill_to_check: 0,
            slope_per: 0.0,
            slope_penalties: Vec::new(),
            conditions: HashMap::new(),
            condition_values: HashMap::new(),
            is_last_spurt: false,
            last_spurt_speed: 0.0,
            last_spurt_transition: -1.0,
            has_achieved_full_spurt: false,
            non_full_spurt_velocity_diff: None,
            non_full_spurt_delay_distance: None,
            out_of_hp: false,
            out_of_hp_position: None,
            is_rushed: false,
            rushed_enabled: true,
            is_downhill_mode: false,
            is_dueling: false,
            in_spot_struggle: false,
            spot_struggle_distance_exited: false,
            is_fully_charged: false,
            conserve_power_enabled: true,
            conserve_power_stat: f64::from(props.stats.power),
            conserved_power: 0.0,
            last_conserve_power_check_frame: 0,
            conserve_power_saw_rushed: false,
            conserve_power_saw_spot_struggle: false,
            fully_charged_timer: Timer::new(0.0),
            fully_charged_duration: 0.0,
            fully_charged_accel: 0.0,
            fully_charged_region: None,
            distance_type: course.distance_type,
            has_been_rushed: false,
            rushed_section: -1,
            rushed_enter_position: -1.0,
            rushed_end_position: -1.0,
            rushed_timer: Timer::new(0.0),
            rushed_max_duration: 12.0,
            rushed_activations: Vec::new(),
            pre_rushed_pos_keep_strategy: props.strategy,
            forced_rushed_index: 0,
            is_in_forced_rushed: false,
            has_dueled: false,
            can_duel: None,
            dueling_timer: Timer::new(0.0),
            dueling_start_position: -1.0,
            dueling_end_position: -1.0,
            forced_dueling_index: 0,
            is_in_forced_dueling: false,
            has_spot_struggle: false,
            spot_struggle_timer: Timer::new(0.0),
            spot_struggle_start_position: None,
            spot_struggle_end_position: -1.0,
            forced_spot_struggle_index: 0,
            is_in_forced_spot_struggle: false,
            downhill_mode_start: None,
            last_downhill_check_frame: 0,
            dueling_enabled: true,
            spot_struggle_enabled: true,
            downhill_enabled: true,
            target_speed_skills_active: Vec::new(),
            current_speed_skills_active: Vec::new(),
            lane_movement_skills_active: Vec::new(),
            change_lane_skills_active: Vec::new(),
            acceleration_skills_active: Vec::new(),
            targeted_target_speed_active: Vec::new(),
            targeted_current_speed_active: Vec::new(),
            targeted_acceleration_active: Vec::new(),
            targeted_lane_movement_skills_active: Vec::new(),
            targeted_change_lane_skills_active: Vec::new(),
            skills_activated_count: 0,
            skills_activated_phase_map: [0; 4],
            skills_activated_half_race_map: [0; 2],
            heals_activated_count: 0,
            used_skills: std::collections::HashSet::new(),
            activated_ledger: crate::skills::activated_ledger::ActivatedSkillLedger::new(),
            activated_advantage_effect_types: 0,
            used_targeted_skills: Vec::new(),
            emitted_debuffs: Vec::new(),
            pending_skills: Vec::new(),
            pending_targeted_skills: Vec::new(),
            pending_skill_removal: std::collections::HashSet::new(),
            course_distance: course.distance,
            horse_lane: course.horse_lane,
            wit_checks_enabled: true,
            stamina_drain_overrides: HashMap::new(),
            position_keep_state: PositionKeepState::None,
            pos_keep_speed_coef: 1.0,
            pos_keep_next_timer: Timer::new(0.0),
            pos_keep_exit_distance: 0.0,
            pos_keep_exit_position: 0.0,
            pos_keep_min_threshold: 0.0,
            pos_keep_max_threshold: 0.0,
            pos_keep_end: 0.0,
            position_keep_activations: Vec::new(),
            pos_keep_rng: Box::new(Xoshiro256StarStar::from_u32_seed(0)),
        }
    }

    /// Reset per-round state so the instance can be reused. Follows the TS
    /// `onPrepare` init chain; the skill-tracking (t-015) and mechanics (t-016)
    /// initializers are wired in by their owning tasks at the marked seams.
    pub fn on_prepare(&mut self, runner_rng: Box<dyn Prng>, ctx: &PrepareContext<'_>) {
        let course = ctx.course;
        let course_distance = course.distance;

        // ---- hard resets (deterministic per round) ----
        // Restore pristine stats so green stat skills (SpeedUp/StaminaUp/…),
        // which permanently mutate base/adjusted stats, do not accumulate across
        // rounds in a batch/compare run (mirrors TS `onPrepare` resetting
        // `baseStats`/`adjustedStats` from `_baseStats`/`_adjustedStats`).
        self.base_stats = self.pristine_base_stats;
        self.adjusted_stats = self.pristine_adjusted_stats;
        self.first_position_in_late_race = false;
        self.finish_time = 0.0;
        self.accumulate_time = Timer::new(-1.0);
        self.condition_timer = Timer::new(-1.0);
        self.conditions.clear();
        self.condition_values.clear();
        self.position_keep_strategy = self.strategy;
        self.out_of_hp = false;
        self.out_of_hp_position = None;
        self.is_rushed = false;
        self.is_downhill_mode = false;
        self.is_dueling = false;
        self.in_spot_struggle = false;
        self.is_fully_charged = false;
        self.modifiers = SpeedModifiers::zeroed();

        // ---- dependency-safe init chain (TS onPrepare order) ----
        self.rng = runner_rng;
        self.initialize_rng();
        self.initialize_phase_tracking(course_distance);
        self.initialize_last_spurt();
        self.initialize_lane_state(course.horse_lane); // requires gate assigned
        self.initialize_movement_state(ctx.base_speed); // seeds start_delay
        self.initialize_skill_tracking(ctx); // build pending skills
        self.initialize_rushed_state();
        self.activate_gate_skills(course_distance); // green skills may modify stats
        self.start_delay_accumulator = self.start_delay; // resync after gate delay skills
        self.initialize_speed_calculations(ctx.base_speed);
        self.initialize_hills(course);
        self.initialize_downhill_mode();
        self.initialize_dueling();
        self.initialize_spot_struggle();
        self.initialize_power_conservation(course.distance_type);
        initialize_position_keep(self, course_distance, ctx.pos_keep_end_multiplier);
        self.initialize_health_policy();
        self.initialize_base_accelerations(course);
        self.register_approximate_conditions();
    }

    /// Spawn the RNG sub-streams (TS order) and roll the random lot.
    ///
    /// Mirrors `initializeRng`. Each sub-stream is seeded from a fresh `int32`
    /// draw of the master stream; the consuming logic is added by t-015/t-016.
    fn initialize_rng(&mut self) {
        self.rushed_rng = Box::new(Xoshiro256StarStar::from_u32_seed(self.rng.int32()));
        self.wit_rng = Box::new(Xoshiro256StarStar::from_u32_seed(self.rng.int32()));
        self.downhill_rng = Box::new(Xoshiro256StarStar::from_u32_seed(self.rng.int32()));
        self.pos_keep_rng = Box::new(Xoshiro256StarStar::from_u32_seed(self.rng.int32()));
        self.lane_movement_rng = Box::new(Xoshiro256StarStar::from_u32_seed(self.rng.int32()));
        self.skill_rng = Box::new(Xoshiro256StarStar::from_u32_seed(self.rng.int32()));
        self.force_skill_activator_rng =
            Box::new(Xoshiro256StarStar::from_u32_seed(self.rng.int32()));
        self.dueling_rng = Box::new(Xoshiro256StarStar::from_u32_seed(self.rng.int32()));
        self.sync_rng = Box::new(Xoshiro256StarStar::from_u32_seed(self.rng.int32()));
        self.random_lot = i64::from(self.rng.uniform(100));
    }

    /// Initialise the stamina policy from the adjusted stats
    /// (`initializeHealthPolicy`).
    fn initialize_health_policy(&mut self) {
        self.health_policy.init(&StaminaStats {
            strategy: self.strategy,
            stamina: self.adjusted_stats.stamina,
            guts: self.adjusted_stats.guts,
            wit: self.adjusted_stats.wit,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runner::test_support::{test_race_params, test_whole_course};
    use crate::shared_kernel::language::{DistanceType, Orientation, Surface};
    use crate::skills::condition::catalog::build_catalog;
    use crate::stamina::game_policy::GameStaminaPolicy;
    use crate::stamina::policy::NoopStaminaPolicy;

    fn course() -> CourseData {
        CourseData {
            course_id: 1,
            race_track_id: 10001,
            distance: 2400.0,
            distance_type: DistanceType::Long,
            surface: Surface::Turf,
            turn: Orientation::Clockwise,
            course_set_status: vec![],
            corners: vec![],
            straights: vec![],
            slopes: vec![],
            lane_max: 10.0,
            course_width: 30.0,
            horse_lane: 1.5,
            lane_change_acceleration: 0.0,
            lane_change_acceleration_per_frame: 0.0,
            max_lane_distance: 0.0,
            move_lane_point: 0.0,
            is_abroad: false,
        }
    }

    fn props(strategy: Strategy) -> CreateRunner {
        CreateRunner {
            outfit_id: "100302".to_owned(),
            name: "Test Runner".to_owned(),
            mood: Mood::Great,
            strategy,
            popularity: 0,
            team: None,
            aptitudes: RunnerAptitudes {
                distance: Aptitude::A,
                strategy: Aptitude::A,
                surface: Aptitude::A,
            },
            stats: StatLine {
                speed: 1200,
                stamina: 1000,
                power: 900,
                guts: 600,
                wit: 800,
            },
            skills: vec![],
            forced_positions: HashMap::new(),
            injected_debuffs: vec![],
            forced_rushed_regions: vec![],
            forced_dueling_regions: vec![],
            forced_spot_struggle_regions: vec![],
            forced_rank: vec![],
        }
    }

    fn make_runner(strategy: Strategy) -> Runner {
        Runner::create(
            RunnerId(0),
            &course(),
            GroundCondition::Firm,
            props(strategy),
            Box::new(NoopStaminaPolicy),
            Box::new(Xoshiro256StarStar::from_u64_seed(99)),
        )
    }

    #[test]
    fn create_derives_uma_id_and_stats() {
        let r = make_runner(Strategy::PaceChaser);
        assert_eq!(r.uma_id, "1003");
        // Great mood (1.04), no overcap on these stats; Firm turf ground mods = 0;
        // strategy aptitude A = 1.0, no course set status.
        assert_eq!(r.base_stats.speed, 1200.0 * 1.04);
        assert_eq!(r.adjusted_stats.speed, 1200.0 * 1.04);
        assert_eq!(r.adjusted_stats.stamina, 1000.0 * 1.04);
    }

    #[test]
    fn on_prepare_resets_position_keep_and_kinematics() {
        let course = course();
        let catalog = build_catalog();
        let parser = ConditionParser::new(&catalog);
        let rp = test_race_params();
        let wc = test_whole_course(&course);
        let ctx = PrepareContext {
            course: &course,
            base_speed: 19.6,
            condition_resolution: ConditionResolution::Dynamic,
            pos_keep_end_multiplier: 3.0,
            race_params: &rp,
            whole_course: &wc,
            parser: &parser,
            skill_samples: 4,
            round_iteration: 0,
        };
        let mut r = make_runner(Strategy::PaceChaser);
        // Dirty some state.
        r.position = 1234.0;
        r.position_keep_state = PositionKeepState::PaceUp;
        r.is_rushed = true;

        r.on_prepare(Box::new(Xoshiro256StarStar::from_u64_seed(7)), &ctx);

        assert_eq!(r.position, 0.0);
        assert_eq!(r.current_speed, 3.0);
        assert_eq!(r.section_length, 100.0);
        assert!(!r.is_rushed);
        assert_eq!(r.position_keep_state, PositionKeepState::None);
        assert_eq!(r.pos_keep_end, 300.0); // normal mode = section_length * 3
        assert!(r.pos_keep_max_threshold > r.pos_keep_min_threshold);
        assert!((0..100).contains(&r.random_lot));
    }

    #[test]
    fn on_prepare_restores_pristine_stats_so_green_skills_do_not_accumulate() {
        // Regression (ADR-0004 Option-B bug #3): green stat skills (SpeedUp/
        // StaminaUp/…) permanently mutate base/adjusted stats. Across a batch /
        // compare run, `on_prepare` must restore pristine stats each round so the
        // bonus does not stack round-over-round (1140 -> 1180 -> 1220 …).
        let course = course();
        let catalog = build_catalog();
        let parser = ConditionParser::new(&catalog);
        let rp = test_race_params();
        let wc = test_whole_course(&course);
        let ctx = PrepareContext {
            course: &course,
            base_speed: 19.6,
            condition_resolution: ConditionResolution::Dynamic,
            pos_keep_end_multiplier: 3.0,
            race_params: &rp,
            whole_course: &wc,
            parser: &parser,
            skill_samples: 4,
            round_iteration: 0,
        };
        let mut r = make_runner(Strategy::PaceChaser);
        let pristine_base = r.pristine_base_stats.speed;
        let pristine_adjusted = r.pristine_adjusted_stats.speed;

        // Round 1, then a green SpeedUp permanently bumps stats mid-round.
        r.on_prepare(Box::new(Xoshiro256StarStar::from_u64_seed(1)), &ctx);
        r.base_stats.speed += 400.0;
        r.adjusted_stats.speed += 400.0;

        // Round 2: the per-round reset must wipe the accumulated bonus.
        r.on_prepare(Box::new(Xoshiro256StarStar::from_u64_seed(2)), &ctx);
        assert_eq!(r.base_stats.speed, pristine_base);
        assert_eq!(r.adjusted_stats.speed, pristine_adjusted);

        // Repeated rounds never stack: bump again, prepare again, still pristine.
        r.base_stats.speed += 400.0;
        r.adjusted_stats.speed += 400.0;
        r.on_prepare(Box::new(Xoshiro256StarStar::from_u64_seed(3)), &ctx);
        assert_eq!(r.base_stats.speed, pristine_base);
        assert_eq!(r.adjusted_stats.speed, pristine_adjusted);
    }

    #[test]
    fn on_prepare_initializes_game_health_policy() {
        let course = course();
        let catalog = build_catalog();
        let parser = ConditionParser::new(&catalog);
        let rp = test_race_params();
        let wc = test_whole_course(&course);
        let ctx = PrepareContext {
            course: &course,
            base_speed: 19.6,
            condition_resolution: ConditionResolution::Dynamic,
            pos_keep_end_multiplier: 3.0,
            race_params: &rp,
            whole_course: &wc,
            parser: &parser,
            skill_samples: 4,
            round_iteration: 0,
        };
        let policy: Box<dyn StaminaPolicy> = Box::new(GameStaminaPolicy::new(
            &course,
            GroundCondition::Firm,
            Box::new(Xoshiro256StarStar::from_u64_seed(3)),
        ));
        let mut r = Runner::create(
            RunnerId(1),
            &course,
            GroundCondition::Firm,
            props(Strategy::LateSurger),
            policy,
            Box::new(Xoshiro256StarStar::from_u64_seed(5)),
        );
        r.on_prepare(Box::new(Xoshiro256StarStar::from_u64_seed(8)), &ctx);
        // Max HP = 0.8 * 1.0 (LateSurger) * adjusted_stamina + distance > distance.
        assert!(r.health_policy.current_health() > 2400.0);
        assert_eq!(r.health_policy.health_ratio_remaining(), 1.0);
    }
}
