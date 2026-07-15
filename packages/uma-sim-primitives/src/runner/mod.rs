//! # Runner entity
//!
//! The `Runner` is the core **entity** within the `Race` aggregate (identity =
//! `RunnerId`, mutable per-round lifecycle). Its behavior is split across
//! submodules for readability: lifecycle/init, physics, skills, and the game
//! mechanics (rushed/dueling/spot-struggle/downhill/last-spurt).
//!
//! ## Skeleton status
//!
//! The struct below is the **entity skeleton**: it currently carries the
//! identity, kinematic, and position-keep fields needed by the position-keep /
//! pacing domain services (t-011). The remaining fields (full skill state,
//! rushed/dueling/spot-struggle/downhill mechanics, the per-stream RNGs, etc.)
//! and the construction / lifecycle reset are added by t-013..t-016. New fields
//! are additive — they do not invalidate the position-keep behavior defined here.

pub mod lifecycle;
pub mod mechanics;
pub mod observation;
pub mod physics;
pub mod skills;
pub mod stats;

use std::collections::{HashMap, HashSet};

use crate::shared_kernel::ids::{RunnerId, SkillId};
use crate::shared_kernel::language::{DistanceType, Mood, Phase, Strategy};
use crate::shared_kernel::math::Timer;
use crate::shared_kernel::params::StatLine;
use crate::shared_kernel::rng::Prng;
use crate::skills::condition::approximate::ApproximateCondition;
use crate::skills::effect::{PositionKeepState, SkillTarget, SkillType};
use crate::skills::model::{
    ActiveSkill, ActiveTargetedSkill, PendingSkill, PendingTargetedSkill, Skill,
};
use crate::stamina::policy::StaminaPolicy;

use self::lifecycle::RunnerAptitudes;
use self::physics::{Hill, SpeedModifiers};
use self::stats::RunnerStats;

/// A `[start, end)` region used by scripted forced-state overrides.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ForcedRegion {
    /// Region start position.
    pub start: f64,
    /// Region end position.
    pub end: f64,
}

/// A debuff injected onto this runner at a fixed position (compare-mode rival
/// modelling).
#[derive(Debug, Clone, PartialEq)]
pub struct InjectedDebuff {
    /// The pre-resolved debuff skill (data layer resolves the id upstream).
    pub skill: Skill,
    /// Position at which it triggers.
    pub position: f64,
}

/// One entry in a runner's position-keep activation log: the `[start, end]`
/// region (end is back-filled on exit) and the state that was active.
///
/// Mirrors the TS tuple `[number, number, IPositionKeepState]`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PositionKeepActivation {
    /// Position where the state began.
    pub start: f64,
    /// Position where the state ended (`0.0` until exit back-fills it).
    pub end: f64,
    /// The position-keep state.
    pub state: PositionKeepState,
}

/// One record in a runner's targeted-skill activation log.
#[derive(Debug, Clone, PartialEq)]
pub struct UsedTargetedSkill {
    /// The skill id that fired.
    pub skill_id: SkillId,
    /// Position where it fired.
    pub position: f64,
    /// The effect type applied.
    pub effect_type: SkillType,
    /// The effect target selector.
    pub effect_target: SkillTarget,
}

/// A forced-rank override region: while the runner is within `[start, end)` its
/// rank is pinned to `rank` (used to reproduce a scripted field).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ForcedRank {
    /// Region start position.
    pub start: f64,
    /// Region end position.
    pub end: f64,
    /// The 1-based rank to force.
    pub rank: i64,
}

/// A runner in a race.
///
/// See the module docs: this is the in-progress entity skeleton. Fields are
/// grouped by concern; the position-keep group is fully wired (t-011), the rest
/// grows in t-013..t-016.
pub struct Runner {
    // --- identity / immutable configuration ---
    /// Identity within the race (assigned by the aggregate in insertion order).
    pub id: RunnerId,
    /// Outfit (costume) id this runner was built from.
    pub outfit_id: String,
    /// Character id (derived from the outfit id prefix).
    pub uma_id: String,
    /// Display name (pre-resolved by the caller).
    pub name: String,
    /// Running style.
    pub strategy: Strategy,
    /// The (possibly promoted) position-keep strategy.
    pub position_keep_strategy: Strategy,
    /// Motivation.
    pub mood: Mood,
    /// Betting popularity rank (1 = most popular). `0` means unknown/unset.
    /// Static for the race; read by the `popularity` skill condition.
    pub popularity: i64,
    /// Distance / strategy / surface aptitudes.
    pub aptitudes: RunnerAptitudes,
    /// Raw input stats (pre-adjustment).
    pub stats: StatLine,
    /// Mood-adjusted base stats. Mutable per round (green StaminaUp skills bump
    /// it); reset from [`pristine_base_stats`](Self::pristine_base_stats) each
    /// `on_prepare`.
    pub base_stats: RunnerStats,
    /// Course/ground/strategy-adjusted effective stats. Mutable per round (green
    /// stat skills bump it); reset from
    /// [`pristine_adjusted_stats`](Self::pristine_adjusted_stats) each `on_prepare`.
    pub adjusted_stats: RunnerStats,
    /// Pristine mood-adjusted base stats (the build-time value). `base_stats` is
    /// reset to this at the start of every round so green stat skills do not
    /// accumulate across rounds in a batch/compare run.
    pub pristine_base_stats: RunnerStats,
    /// Pristine course/ground/strategy-adjusted stats (the build-time value).
    /// `adjusted_stats` is reset to this each round (see above).
    pub pristine_adjusted_stats: RunnerStats,
    /// Pre-resolved skills this runner carries.
    pub skills: Vec<Skill>,
    /// Skill-base-id -> forced activation position overrides.
    pub forced_positions: HashMap<String, f64>,
    /// Debuffs injected onto this runner (compare mode).
    pub injected_debuffs: Vec<InjectedDebuff>,
    /// Scripted rushed regions.
    pub forced_rushed_regions: Vec<ForcedRegion>,
    /// Scripted dueling regions.
    pub forced_dueling_regions: Vec<ForcedRegion>,
    /// Scripted spot-struggle regions.
    pub forced_spot_struggle_regions: Vec<ForcedRegion>,

    // --- stamina ---
    /// The HP-budget policy (strategy object).
    pub health_policy: Box<dyn StaminaPolicy>,

    // --- randomness ---
    /// The runner's master RNG stream (substreams are spawned from it).
    pub rng: Box<dyn Prng>,
    /// Dedicated RNG sub-stream for rushed checks (t-016).
    pub rushed_rng: Box<dyn Prng>,
    /// Dedicated RNG sub-stream for skill wit checks + section variance.
    pub wit_rng: Box<dyn Prng>,
    /// Dedicated RNG sub-stream for downhill checks (t-016).
    pub downhill_rng: Box<dyn Prng>,
    /// Dedicated RNG sub-stream for lane movement (extra-move-lane jitter).
    pub lane_movement_rng: Box<dyn Prng>,
    /// Dedicated RNG sub-stream for skill sampling/activation (t-015).
    pub skill_rng: Box<dyn Prng>,
    /// Dedicated RNG sub-stream for forced gold-skill activation (t-015).
    pub force_skill_activator_rng: Box<dyn Prng>,
    /// Dedicated RNG sub-stream for dueling (t-016).
    pub dueling_rng: Box<dyn Prng>,
    /// Dedicated RNG sub-stream for cross-runner tie-breaks.
    pub sync_rng: Box<dyn Prng>,
    /// Random lot roll used by some skill conditions.
    pub random_lot: i64,

    // --- kinematics ---
    /// Longitudinal race position in meters.
    pub position: f64,
    /// Current speed in m/s.
    pub current_speed: f64,
    /// Target speed this tick.
    pub target_speed: f64,
    /// Minimum speed (floor after the start dash ends).
    pub min_speed: f64,
    /// Current acceleration (m/s^2).
    pub acceleration: f64,
    /// Force-in speed jitter (consumed by some mechanics).
    pub force_in_speed: f64,
    /// Section length (`course.distance / 24`).
    pub section_length: f64,
    /// Per-phase base accelerations (`[flat0,1,2, uphill0,1,2]`).
    pub base_accelerations: [f64; 6],
    /// Per-phase base target speeds (`[early, mid, late]`).
    pub base_target_speed_per_phase: [f64; 3],
    /// Per-tick skill modifier accumulators.
    pub modifiers: SpeedModifiers,
    /// Per-section (1/24) wisdom-variance target-speed modifiers (+ sentinel).
    pub section_modifiers: Vec<f64>,

    // --- timers / phase ---
    /// Per-runner elapsed timer (drives downhill cadence).
    pub accumulate_time: Timer,
    /// Approximate-condition cadence timer (ticks once per second).
    pub condition_timer: Timer,
    /// Current race phase.
    pub phase: Phase,
    /// Position of the next phase transition.
    pub next_phase_transition: f64,

    // --- start / gate ---
    /// Whether the runner is still in the start dash.
    pub start_dash: bool,
    /// Assigned gate (post) number (set by the aggregate before `on_prepare`).
    pub gate: i64,
    /// Start delay in seconds.
    pub start_delay: f64,
    /// Remaining start-delay budget.
    pub start_delay_accumulator: f64,
    /// Whether the runner has finished the round.
    pub finished: bool,
    /// Finish time in seconds (`0` until finished).
    pub finish_time: f64,

    // --- lane ---
    /// Current lateral lane offset.
    pub current_lane: f64,
    /// Target lateral lane offset.
    pub target_lane: f64,
    /// Extra lane move after the final corner (`-1` until armed).
    pub extra_move_lane: f64,
    /// Current lane-change speed.
    pub lane_change_speed: f64,
    /// Whether a runner is blocking this runner's side this tick (telemetry).
    pub is_side_blocked: bool,
    /// Whether this runner is overtaking this tick (telemetry).
    pub is_overtaking: bool,

    // --- race awareness ---
    /// Whether this runner is marked leader in the late race.
    pub first_position_in_late_race: bool,

    // --- hills ---
    /// Resolved hill segments (sorted by start).
    pub hills: Vec<Hill>,
    /// Index of the hill currently occupied (`-1` = none).
    pub current_hill_index: i64,
    /// Index of the next hill to test for entry.
    pub next_hill_to_check: usize,
    /// Current slope (positive uphill, negative downhill).
    pub slope_per: f64,
    /// Per-slope HP penalties.
    pub slope_penalties: Vec<f64>,

    // --- approximate conditions (compare mode) ---
    /// Registered approximate conditions keyed by name.
    pub conditions: HashMap<String, Box<dyn ApproximateCondition>>,
    /// Latest approximate-condition values.
    pub condition_values: HashMap<String, i32>,

    // --- last spurt (updated by t-016, read by physics) ---
    /// Whether the runner is in last spurt.
    pub is_last_spurt: bool,
    /// Last-spurt speed.
    pub last_spurt_speed: f64,
    /// Last-spurt transition position (`-1` until transitioned).
    pub last_spurt_transition: f64,
    /// Whether the runner committed to a full spurt.
    pub has_achieved_full_spurt: bool,
    /// Velocity difference recorded for non-full spurts.
    pub non_full_spurt_velocity_diff: Option<f64>,
    /// Delay distance recorded for non-full spurts.
    pub non_full_spurt_delay_distance: Option<f64>,

    // --- health ---
    /// Whether the runner has run out of HP.
    pub out_of_hp: bool,
    /// Distance remaining when HP ran out.
    pub out_of_hp_position: Option<f64>,

    // --- mechanics flags read by physics (full machinery added in t-016) ---
    /// Whether the runner is rushed (temptation).
    pub is_rushed: bool,
    /// Whether the runner is in downhill (HP-saving) mode.
    pub is_downhill_mode: bool,
    /// Whether the runner is dueling.
    pub is_dueling: bool,
    /// Whether the runner is in a spot-struggle.
    pub in_spot_struggle: bool,
    /// Whether the runner's spot-struggle ended via the distance/lateral exit
    /// (as opposed to natural duration expiry); drives the cascade exit for
    /// the last remaining struggler.
    pub spot_struggle_distance_exited: bool,
    /// Whether Fully Charged release acceleration is active.
    pub is_fully_charged: bool,

    // --- power-conservation / fully-charged state machine ---
    /// Whether power conservation is enabled for this runner.
    pub conserve_power_enabled: bool,
    /// Un-halved power value used by the Power Conservation formula.
    pub conserve_power_stat: f64,
    /// Accumulated conserved-power gauge.
    pub conserved_power: f64,
    /// Last frame at which a conserve-power check ran.
    pub last_conserve_power_check_frame: i64,
    /// Whether this runner has ever rushed this round (for release activity coef).
    pub conserve_power_saw_rushed: bool,
    /// Whether this runner has ever spot-struggled this round (for release activity coef).
    pub conserve_power_saw_spot_struggle: bool,
    /// Fully Charged release timer.
    pub fully_charged_timer: Timer,
    /// Fully Charged release duration in seconds.
    pub fully_charged_duration: f64,
    /// Fully Charged release acceleration bonus.
    pub fully_charged_accel: f64,
    /// Closed Fully Charged release region, if it triggered.
    pub fully_charged_region: Option<(f64, f64)>,
    /// Course distance bucket used by the release formula.
    pub distance_type: DistanceType,

    // --- rushed (temptation) state machine ---
    /// Whether the runner has already been rushed this round.
    pub has_been_rushed: bool,
    /// The pre-determined rushed section (`-1` if none).
    pub rushed_section: i64,
    /// Position at which rushed activates.
    pub rushed_enter_position: f64,
    /// Position at which rushed ended.
    pub rushed_end_position: f64,
    /// Rushed-duration timer.
    pub rushed_timer: Timer,
    /// Maximum rushed duration in seconds.
    pub rushed_max_duration: f64,
    /// Log of `[start, end]` rushed activations.
    pub rushed_activations: Vec<(f64, f64)>,
    /// Position-keep strategy before rushing (restored on exit).
    pub pre_rushed_pos_keep_strategy: Strategy,
    /// Index into forced rushed regions.
    pub forced_rushed_index: usize,
    /// Whether currently inside a forced rushed region.
    pub is_in_forced_rushed: bool,

    // --- dueling state machine ---
    /// Whether the runner has dueled this round.
    pub has_dueled: bool,
    /// Whether the runner may duel (lazily resolved; `None` = undecided).
    pub can_duel: Option<bool>,
    /// Dueling cadence timer.
    pub dueling_timer: Timer,
    /// Position where dueling began.
    pub dueling_start_position: f64,
    /// Position where dueling ended.
    pub dueling_end_position: f64,
    /// Index into forced dueling regions.
    pub forced_dueling_index: usize,
    /// Whether currently inside a forced dueling region.
    pub is_in_forced_dueling: bool,

    // --- spot-struggle state machine ---
    /// Whether the runner has spot-struggled this round.
    pub has_spot_struggle: bool,
    /// Spot-struggle duration timer.
    pub spot_struggle_timer: Timer,
    /// Position where spot-struggle began (`None` until triggered).
    pub spot_struggle_start_position: Option<f64>,
    /// Position where spot-struggle ends.
    pub spot_struggle_end_position: f64,
    /// Index into forced spot-struggle regions.
    pub forced_spot_struggle_index: usize,
    /// Whether currently inside a forced spot-struggle region.
    pub is_in_forced_spot_struggle: bool,

    // --- downhill mode ---
    /// Frame at which downhill mode started (`None` when inactive).
    pub downhill_mode_start: Option<i64>,
    /// Last frame a downhill check ran.
    pub last_downhill_check_frame: i64,

    // --- mechanics settings ---
    /// Whether dueling is enabled for this race.
    pub dueling_enabled: bool,
    /// Whether spot-struggle is enabled for this race.
    pub spot_struggle_enabled: bool,
    /// Whether downhill mode is enabled for this race.
    pub downhill_enabled: bool,

    // --- active skill effects (position keeping checks emptiness) ---
    /// Active self target-speed effects.
    pub target_speed_skills_active: Vec<ActiveSkill>,
    /// Active self current-speed effects.
    pub current_speed_skills_active: Vec<ActiveSkill>,
    /// Active self lane-movement effects (read by physics; populated by t-015).
    pub lane_movement_skills_active: Vec<ActiveSkill>,
    /// Active self change-lane effects (read by physics; populated by t-015).
    pub change_lane_skills_active: Vec<ActiveSkill>,
    /// Active self acceleration effects.
    pub acceleration_skills_active: Vec<ActiveSkill>,
    /// Active targeted target-speed effects.
    pub targeted_target_speed_active: Vec<ActiveTargetedSkill>,
    /// Active targeted current-speed effects.
    pub targeted_current_speed_active: Vec<ActiveTargetedSkill>,
    /// Active targeted acceleration effects.
    pub targeted_acceleration_active: Vec<ActiveTargetedSkill>,
    /// Active targeted lane-movement effects.
    pub targeted_lane_movement_skills_active: Vec<ActiveTargetedSkill>,
    /// Active targeted change-lane effects.
    pub targeted_change_lane_skills_active: Vec<ActiveTargetedSkill>,

    // --- skill activation tracking ---
    /// Total skills activated this round.
    pub skills_activated_count: i64,
    /// Skills activated per phase index (Early/Mid/Late/LastSpurt).
    pub skills_activated_phase_map: [i64; 4],
    /// Skills activated per half-race (first/second).
    pub skills_activated_half_race_map: [i64; 2],
    /// Recovery (heal) skills activated.
    pub heals_activated_count: i64,
    /// Skill ids already used this round.
    pub used_skills: HashSet<String>,
    /// Ledger of activated skills carrying green master-data tags, used by
    /// caster-context value scaling (usage 14). Reset each round.
    pub activated_ledger: crate::skills::activated_ledger::ActivatedSkillLedger,
    /// Bitmask of positive self-applied effect types activated this race (bit
    /// `n` set => SkillType id `n` activated). Read by
    /// `is_other_character_activate_advantage_skill`.
    pub activated_advantage_effect_types: u64,
    /// Targeted-skill activation log.
    pub used_targeted_skills: Vec<UsedTargetedSkill>,
    /// Opponent-facing debuffs this runner emitted this frame, awaiting the race
    /// aggregate to route them onto target runners. Drained every frame by the
    /// `coordinate_external_debuffs` coordinator pass.
    pub emitted_debuffs: Vec<crate::skills::model::EmittedDebuff>,
    /// Pending self-skills awaiting their trigger.
    pub pending_skills: Vec<PendingSkill>,
    /// Pending targeted skills awaiting their trigger.
    pub pending_targeted_skills: Vec<PendingTargetedSkill>,
    /// Skill ids flagged for removal next activation pass.
    pub pending_skill_removal: HashSet<String>,

    // --- course scalars (for RunnerView) ---
    /// Total course distance in meters.
    pub course_distance: f64,
    /// Per-horse lane width.
    pub horse_lane: f64,

    // --- skill activation settings ---
    /// Whether wit checks gate non-green/non-unique skill activation.
    pub wit_checks_enabled: bool,
    /// Per-base-skill stamina-drain (recovery) override modifiers.
    pub stamina_drain_overrides: HashMap<String, f64>,

    // --- position-keep state machine ---
    /// Current position-keep state.
    pub position_keep_state: PositionKeepState,
    /// Speed coefficient applied by the current state.
    pub pos_keep_speed_coef: f64,
    /// Cooldown timer gating re-entry into a state.
    pub pos_keep_next_timer: Timer,
    /// Behind-distance threshold at which a pace-up/down state exits.
    pub pos_keep_exit_distance: f64,
    /// Position at which the current state exits.
    pub pos_keep_exit_position: f64,
    /// Minimum behind-distance threshold for this runner.
    pub pos_keep_min_threshold: f64,
    /// Maximum behind-distance threshold for this runner.
    pub pos_keep_max_threshold: f64,
    /// Position past which position keeping stops entirely.
    pub pos_keep_end: f64,
    /// Log of position-keep activations this round.
    pub position_keep_activations: Vec<PositionKeepActivation>,
    /// Dedicated RNG sub-stream for position-keep wit checks.
    pub pos_keep_rng: Box<dyn Prng>,

    // --- scripted overrides ---
    /// Forced-rank regions (empty when unscripted).
    pub forced_rank: Vec<ForcedRank>,
}

/// Shared constructors for unit tests across the `racing` context.
#[cfg(any(test, feature = "test-support"))]
pub mod test_support {
    use super::Runner;
    use crate::runner::lifecycle::{CreateRunner, RunnerAptitudes};
    use crate::shared_kernel::ids::RunnerId;
    use crate::shared_kernel::language::{
        Aptitude, DistanceType, Grade, GroundCondition, Mood, Orientation, Season, Strategy,
        Surface, TimeOfDay, Weather,
    };
    use crate::shared_kernel::params::{RaceParameters, StatLine};
    use crate::shared_kernel::region::{Region, RegionList};
    use crate::shared_kernel::rng::Xoshiro256StarStar;
    use crate::skills::condition::catalog::build_catalog;
    use crate::skills::condition::ConditionCatalog;
    use crate::stamina::policy::NoopStaminaPolicy;
    use std::collections::HashMap;

    /// The static condition catalog for tests.
    pub fn test_catalog() -> ConditionCatalog {
        build_catalog()
    }

    /// Minimal race parameters for tests (firm turf, summer G1).
    pub fn test_race_params() -> RaceParameters {
        RaceParameters {
            ground: GroundCondition::Firm,
            weather: Weather::Sunny,
            season: Season::Spring,
            time_of_day: TimeOfDay::Midday,
            grade: Grade::G1,
            num_umas: Some(9),
            order_range: None,
            skill_id: None,
            strategy_counts: None,
            common_skills: None,
        }
    }

    /// The whole course as a single `[0, distance)` region.
    pub fn test_whole_course(course: &crate::course::model::CourseData) -> RegionList {
        let mut regions = RegionList::new();
        regions.push(Region::new(0.0, course.distance));
        regions
    }

    /// A minimal 2400m turf course for entity construction in tests.
    pub fn test_course() -> crate::course::model::CourseData {
        crate::course::model::CourseData {
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

    /// Build a runner with the given id + strategy, default 800-wit stats and a
    /// no-op stamina policy.
    pub fn test_runner(id: u32, strategy: Strategy) -> Runner {
        let props = CreateRunner {
            outfit_id: "100302".to_owned(),
            name: format!("Runner {id}"),
            mood: Mood::Normal,
            strategy,
            popularity: 0,
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
        };
        Runner::create(
            RunnerId(id),
            &test_course(),
            GroundCondition::Firm,
            props,
            Box::new(NoopStaminaPolicy),
            Box::new(Xoshiro256StarStar::from_u32_seed(id)),
        )
    }
}
