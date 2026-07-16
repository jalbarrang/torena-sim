//! serde boundary DTOs and their conversions to/from domain value objects.
//!
//! This is the **anti-corruption layer**: the JS side speaks numeric enums and
//! camelCase keys; the domain speaks name-based enums and snake_case. All that
//! translation lives here so the core stays serde-light. Conversions are
//! fallible (`Result<_, DtoError>`) — invalid enum codes are reported, never
//! panicked.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use uma_sim_primitives::course::model::{Corner, CourseData, Slope, Straight};
use uma_sim_primitives::projection::{EffectPerspective, SkillEffectLog};
use uma_sim_primitives::runner::lifecycle::{CreateRunner, RunnerAptitudes};
use uma_sim_primitives::runner::mechanics::DuelingRates;
use uma_sim_primitives::runner::{ForcedRank, ForcedRegion, InjectedDebuff};
use uma_sim_primitives::shared_kernel::ids::{RunnerId, SkillId};
use uma_sim_primitives::shared_kernel::language::{
    Aptitude, DistanceType, Grade, GroundCondition, Mood, Orientation, Season, Strategy, Surface,
    ThresholdStat, TimeOfDay, Weather,
};
use uma_sim_primitives::shared_kernel::params::{RaceParameters, StatLine};
use uma_sim_primitives::skills::effect::{SkillRarity, SkillTarget};
use uma_sim_primitives::skills::model::{RawSkillEffect, Skill, SkillAlternative};
use uma_sim_primitives::skills::value_scaling::ValueScalingPolicy;
use uma_sim_race::collectors::{CollectedData, RaceEventLog, RaceLogEvent, RaceLogEventKind};
use uma_sim_race::simulation::{ContestedCompareParams, FinishEntry, RaceSimParams, RaceSimResult};
use uma_sim_race::SimulationSettings as RaceSettings;
use uma_sim_vacuum::collectors::{CompareData, CompareRoundData};
use uma_sim_vacuum::simulation::CompareSimParams;
use uma_sim_vacuum::SimulationSettings as VacuumSettings;

/// An invalid value crossing the JS boundary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DtoError(pub String);

impl std::fmt::Display for DtoError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for DtoError {}

fn invalid(kind: &str, value: i32) -> DtoError {
    DtoError(format!("invalid {kind} code: {value}"))
}

// --------- enum converters (numeric -> domain) ---------

fn to_surface(v: i32) -> Result<Surface, DtoError> {
    match v {
        1 => Ok(Surface::Turf),
        2 => Ok(Surface::Dirt),
        _ => Err(invalid("surface", v)),
    }
}

fn to_distance_type(v: i32) -> Result<DistanceType, DtoError> {
    match v {
        1 => Ok(DistanceType::Short),
        2 => Ok(DistanceType::Mile),
        3 => Ok(DistanceType::Mid),
        4 => Ok(DistanceType::Long),
        _ => Err(invalid("distanceType", v)),
    }
}

fn to_orientation(v: i32) -> Result<Orientation, DtoError> {
    match v {
        1 => Ok(Orientation::Clockwise),
        2 => Ok(Orientation::Counterclockwise),
        3 => Ok(Orientation::UnusedOrientation),
        4 => Ok(Orientation::NoTurns),
        _ => Err(invalid("turn", v)),
    }
}

fn to_threshold_stat(v: i32) -> Result<ThresholdStat, DtoError> {
    match v {
        1 => Ok(ThresholdStat::Speed),
        2 => Ok(ThresholdStat::Stamina),
        3 => Ok(ThresholdStat::Power),
        4 => Ok(ThresholdStat::Guts),
        5 => Ok(ThresholdStat::Wit),
        _ => Err(invalid("courseSetStatus", v)),
    }
}

fn to_strategy(v: i32) -> Result<Strategy, DtoError> {
    match v {
        1 => Ok(Strategy::FrontRunner),
        2 => Ok(Strategy::PaceChaser),
        3 => Ok(Strategy::LateSurger),
        4 => Ok(Strategy::EndCloser),
        5 => Ok(Strategy::Runaway),
        _ => Err(invalid("strategy", v)),
    }
}

fn to_mood(v: i32) -> Result<Mood, DtoError> {
    match v {
        -2 => Ok(Mood::Awful),
        -1 => Ok(Mood::Bad),
        0 => Ok(Mood::Normal),
        1 => Ok(Mood::Good),
        2 => Ok(Mood::Great),
        _ => Err(invalid("mood", v)),
    }
}

fn to_aptitude(v: i32) -> Result<Aptitude, DtoError> {
    match v {
        0 => Ok(Aptitude::S),
        1 => Ok(Aptitude::A),
        2 => Ok(Aptitude::B),
        3 => Ok(Aptitude::C),
        4 => Ok(Aptitude::D),
        5 => Ok(Aptitude::E),
        6 => Ok(Aptitude::F),
        7 => Ok(Aptitude::G),
        _ => Err(invalid("aptitude", v)),
    }
}

fn to_ground(v: i32) -> Result<GroundCondition, DtoError> {
    match v {
        1 => Ok(GroundCondition::Firm),
        2 => Ok(GroundCondition::Good),
        3 => Ok(GroundCondition::Soft),
        4 => Ok(GroundCondition::Heavy),
        _ => Err(invalid("ground", v)),
    }
}

fn to_weather(v: i32) -> Result<Weather, DtoError> {
    match v {
        1 => Ok(Weather::Sunny),
        2 => Ok(Weather::Cloudy),
        3 => Ok(Weather::Rainy),
        4 => Ok(Weather::Snowy),
        _ => Err(invalid("weather", v)),
    }
}

fn to_season(v: i32) -> Result<Season, DtoError> {
    match v {
        1 => Ok(Season::Spring),
        2 => Ok(Season::Summer),
        3 => Ok(Season::Autumn),
        4 => Ok(Season::Winter),
        5 => Ok(Season::Sakura),
        _ => Err(invalid("season", v)),
    }
}

fn to_time_of_day(v: i32) -> Result<TimeOfDay, DtoError> {
    match v {
        0 => Ok(TimeOfDay::NoTime),
        1 => Ok(TimeOfDay::Morning),
        2 => Ok(TimeOfDay::Midday),
        3 => Ok(TimeOfDay::Evening),
        4 => Ok(TimeOfDay::Night),
        _ => Err(invalid("timeOfDay", v)),
    }
}

fn to_grade(v: i32) -> Result<Grade, DtoError> {
    match v {
        100 => Ok(Grade::G1),
        200 => Ok(Grade::G2),
        300 => Ok(Grade::G3),
        400 => Ok(Grade::Op),
        700 => Ok(Grade::PreOp),
        800 => Ok(Grade::Maiden),
        900 => Ok(Grade::Debut),
        999 => Ok(Grade::Daily),
        _ => Err(invalid("grade", v)),
    }
}

fn to_rarity(v: i32) -> Result<SkillRarity, DtoError> {
    match v {
        1 => Ok(SkillRarity::White),
        2 => Ok(SkillRarity::Gold),
        // 1*/2* uniques, upgrades, and natural 3* uniques all collapse to Unique.
        3..=5 => Ok(SkillRarity::Unique),
        6 => Ok(SkillRarity::Evolution),
        _ => Err(invalid("rarity", v)),
    }
}

fn to_target(v: i32) -> Result<SkillTarget, DtoError> {
    match v {
        // The source data uses 0 for plain self-targeted effects.
        0..=1 => Ok(SkillTarget::SelfTarget),
        2 => Ok(SkillTarget::All),
        4 => Ok(SkillTarget::InFov),
        7 => Ok(SkillTarget::AheadOfPosition),
        9 => Ok(SkillTarget::AheadOfSelf),
        10 => Ok(SkillTarget::BehindSelf),
        11 => Ok(SkillTarget::AllAllies),
        18 => Ok(SkillTarget::EnemyStrategy),
        19 => Ok(SkillTarget::KakariAhead),
        20 => Ok(SkillTarget::KakariBehind),
        21 => Ok(SkillTarget::KakariStrategy),
        22 => Ok(SkillTarget::UmaId),
        23 => Ok(SkillTarget::UsedRecovery),
        _ => Err(invalid("skillTarget", v)),
    }
}

// --------- input DTOs ---------

/// A course corner.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmCorner {
    /// Corner start position.
    pub start: f64,
    /// Corner length.
    pub length: f64,
}

/// A course straight.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmStraight {
    /// Straight start position.
    pub start: f64,
    /// Straight end position.
    pub end: f64,
    /// Opaque front-type classifier from the source data.
    #[serde(default)]
    pub front_type: i32,
}

/// A course slope.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmSlope {
    /// Slope start position.
    pub start: f64,
    /// Slope length.
    pub length: f64,
    /// Slope grade (positive uphill, negative downhill).
    pub slope: f64,
}

/// Course geometry as it crosses the boundary.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmCourseData {
    /// Course id.
    pub course_id: u32,
    /// Race track id.
    pub race_track_id: u32,
    /// Total distance in meters.
    pub distance: f64,
    /// Distance bucket (numeric).
    pub distance_type: i32,
    /// Surface (numeric).
    pub surface: i32,
    /// Orientation (numeric).
    pub turn: i32,
    /// Course "set status" bonus stats (numeric).
    #[serde(default)]
    pub course_set_status: Vec<i32>,
    /// Corners.
    #[serde(default)]
    pub corners: Vec<WasmCorner>,
    /// Straights.
    #[serde(default)]
    pub straights: Vec<WasmStraight>,
    /// Slopes.
    #[serde(default)]
    pub slopes: Vec<WasmSlope>,
    /// Maximum lane index.
    pub lane_max: f64,
    /// Course width.
    pub course_width: f64,
    /// Per-horse lane width.
    pub horse_lane: f64,
    /// Lane-change acceleration.
    pub lane_change_acceleration: f64,
    /// Lane-change acceleration per frame.
    pub lane_change_acceleration_per_frame: f64,
    /// Maximum lane distance.
    pub max_lane_distance: f64,
    /// Lane-change point.
    pub move_lane_point: f64,
    /// Whether the race is held overseas.
    #[serde(default)]
    pub is_abroad: bool,
}

impl WasmCourseData {
    /// Convert to the domain [`CourseData`].
    pub fn into_domain(self) -> Result<CourseData, DtoError> {
        let course_set_status = self
            .course_set_status
            .into_iter()
            .map(to_threshold_stat)
            .collect::<Result<Vec<_>, _>>()?;
        Ok(CourseData {
            course_id: self.course_id,
            race_track_id: self.race_track_id,
            distance: self.distance,
            distance_type: to_distance_type(self.distance_type)?,
            surface: to_surface(self.surface)?,
            turn: to_orientation(self.turn)?,
            course_set_status,
            corners: self
                .corners
                .into_iter()
                .map(|c| Corner {
                    start: c.start,
                    length: c.length,
                })
                .collect(),
            straights: self
                .straights
                .into_iter()
                .map(|s| Straight {
                    start: s.start,
                    end: s.end,
                    front_type: s.front_type,
                })
                .collect(),
            slopes: self
                .slopes
                .into_iter()
                .map(|s| Slope {
                    start: s.start,
                    length: s.length,
                    slope: s.slope,
                })
                .collect(),
            lane_max: self.lane_max,
            course_width: self.course_width,
            horse_lane: self.horse_lane,
            lane_change_acceleration: self.lane_change_acceleration,
            lane_change_acceleration_per_frame: self.lane_change_acceleration_per_frame,
            max_lane_distance: self.max_lane_distance,
            move_lane_point: self.move_lane_point,
            is_abroad: self.is_abroad,
        })
    }
}

/// Five core stats.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct WasmStatLine {
    /// Speed.
    pub speed: i32,
    /// Stamina.
    pub stamina: i32,
    /// Power.
    pub power: i32,
    /// Guts.
    pub guts: i32,
    /// Wit.
    pub wit: i32,
}

impl From<WasmStatLine> for StatLine {
    fn from(s: WasmStatLine) -> Self {
        StatLine {
            speed: s.speed,
            stamina: s.stamina,
            power: s.power,
            guts: s.guts,
            wit: s.wit,
        }
    }
}

/// Aptitudes (numeric).
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct WasmAptitudes {
    /// Distance aptitude.
    pub distance: i32,
    /// Strategy aptitude.
    pub strategy: i32,
    /// Surface aptitude.
    pub surface: i32,
}

impl WasmAptitudes {
    fn into_domain(self) -> Result<RunnerAptitudes, DtoError> {
        Ok(RunnerAptitudes {
            distance: to_aptitude(self.distance)?,
            strategy: to_aptitude(self.strategy)?,
            surface: to_aptitude(self.surface)?,
        })
    }
}

/// A raw skill effect (numeric type/target).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmRawEffect {
    /// Raw modifier (×10000 units).
    pub modifier: f64,
    /// Target selector (numeric).
    pub target: i32,
    /// Effect type id.
    #[serde(rename = "type")]
    pub effect_type: i32,
    /// Optional usage discriminator.
    #[serde(default)]
    pub value_usage: Option<i32>,
    /// Optional level-usage discriminator.
    #[serde(default)]
    pub value_level_usage: Option<i32>,
}

impl WasmRawEffect {
    fn into_domain(self) -> Result<RawSkillEffect, DtoError> {
        Ok(RawSkillEffect {
            modifier: self.modifier,
            target: to_target(self.target)?,
            effect_type: self.effect_type,
            value_usage: self.value_usage,
            value_level_usage: self.value_level_usage,
        })
    }
}

/// A skill condition branch.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmSkillAlternative {
    /// Base duration (×10000 units).
    pub base_duration: f64,
    /// Optional cooldown.
    #[serde(default)]
    pub cooldown_time: Option<f64>,
    /// Activation condition DSL.
    pub condition: String,
    /// Optional precondition DSL.
    #[serde(default)]
    pub precondition: Option<String>,
    /// Raw effects.
    pub effects: Vec<WasmRawEffect>,
}

/// A pre-resolved skill (the TS data layer resolves alternatives + raw
/// conditions and ships them here).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmSkillInput {
    /// Skill id (may carry a `-suffix`).
    pub skill_id: String,
    /// Rarity (numeric).
    pub rarity: i32,
    /// Authoritative master-data tags from `skill_data.tag_id`.
    #[serde(default)]
    pub tags: Vec<i32>,
    /// Condition branches.
    pub alternatives: Vec<WasmSkillAlternative>,
}

impl WasmSkillInput {
    fn into_domain(self) -> Result<Skill, DtoError> {
        let skill_id = self.skill_id;
        let alternatives = self
            .alternatives
            .into_iter()
            .enumerate()
            .map(|(alternative_index, alternative)| {
                let effects = alternative
                    .effects
                    .into_iter()
                    .enumerate()
                    .map(|(effect_index, effect)| {
                        validate_effect_value_usage(
                            &skill_id,
                            alternative_index,
                            effect_index,
                            &effect,
                        )?;
                        effect.into_domain()
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(SkillAlternative {
                    base_duration: alternative.base_duration,
                    cooldown_time: alternative.cooldown_time,
                    condition: alternative.condition,
                    precondition: alternative.precondition,
                    effects,
                })
            })
            .collect::<Result<Vec<_>, DtoError>>()?;

        Ok(Skill {
            skill_id: SkillId::new(skill_id),
            rarity: to_rarity(self.rarity)?,
            tags: self.tags,
            alternatives,
        })
    }
}

fn validate_effect_value_usage(
    skill_id: &str,
    alternative_index: usize,
    effect_index: usize,
    effect: &WasmRawEffect,
) -> Result<(), DtoError> {
    let usage = effect.value_usage.unwrap_or(1);
    let policy = ValueScalingPolicy::from_value_usage(effect.value_usage).map_err(|_| {
        DtoError(format!(
            "skill {skill_id} alternative {alternative_index} effect {effect_index}: unsupported value usage {usage}"
        ))
    })?;
    // Unmodeled effect types are intentionally dropped by `build_skill_effects`.
    // Validate supported usages before this branch, but only validate a
    // policy/type combination when the engine can model that type.
    if let Ok(effect_type) =
        uma_sim_primitives::skills::effect::SkillType::try_from(effect.effect_type)
    {
        if !policy.supports_effect_type(effect_type) {
            return Err(DtoError(format!(
                "skill {skill_id} alternative {alternative_index} effect {effect_index}: value usage {usage} is invalid for effect type {}",
                effect.effect_type
            )));
        }
    }
    Ok(())
}

/// Reject an injected debuff whose skill carries a caster-context value policy
/// (usage 14). The injection harness has no caster, so activated-skill state
/// cannot be resolved; Direct and MultiplyRandom are fine (resolved
/// receiver-locally). This guard is independent of the supported-usage set so it
/// keeps rejecting injected usage 14 even once it becomes a supported policy for
/// normal (cast) skills.
fn reject_caster_context_injection(skill: &WasmSkillInput) -> Result<(), DtoError> {
    use uma_sim_primitives::skills::value_scaling::requires_caster_context;
    for (alternative_index, alternative) in skill.alternatives.iter().enumerate() {
        for (effect_index, effect) in alternative.effects.iter().enumerate() {
            if requires_caster_context(effect.value_usage) {
                return Err(DtoError(format!(
                    "injected debuff {} alternative {alternative_index} effect {effect_index}: value usage {} requires caster context and cannot be injected",
                    skill.skill_id,
                    effect.value_usage.unwrap_or(0)
                )));
            }
        }
    }
    Ok(())
}

/// A debuff injected onto a runner at a fixed position (compare mode).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmInjectedDebuff {
    /// The pre-resolved debuff skill.
    pub skill: WasmSkillInput,
    /// Position at which the debuff fires.
    pub position: f64,
}

/// A scripted `[start, end)` region (rushed / dueling / spot-struggle).
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmForcedRegion {
    /// Region start position.
    pub start: f64,
    /// Region end position.
    pub end: f64,
}

/// A scripted forced-rank region.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmForcedRank {
    /// Region start position.
    pub start: f64,
    /// Region end position.
    pub end: f64,
    /// 1-based rank to pin while inside the region.
    pub rank: i64,
}

/// A runner to add to the field.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmCreateRunner {
    /// Outfit (costume) id.
    pub outfit_id: String,
    /// Display name.
    pub name: String,
    /// Mood (numeric).
    pub mood: i32,
    /// Strategy (numeric).
    pub strategy: i32,
    /// Betting popularity rank (1 = most popular). `0`/omitted = unknown.
    #[serde(default)]
    pub popularity: i64,
    /// Aptitudes.
    pub aptitudes: WasmAptitudes,
    /// Raw stats.
    pub stats: WasmStatLine,
    /// Pre-resolved skills.
    #[serde(default)]
    pub skills: Vec<WasmSkillInput>,
    /// Skill-base-id -> forced activation position.
    #[serde(default)]
    pub forced_positions: HashMap<String, f64>,
    /// Injected debuffs (compare mode).
    #[serde(default)]
    pub injected_debuffs: Vec<WasmInjectedDebuff>,
    /// Scripted rushed regions.
    #[serde(default)]
    pub forced_rushed_regions: Vec<WasmForcedRegion>,
    /// Scripted dueling regions.
    #[serde(default)]
    pub forced_dueling_regions: Vec<WasmForcedRegion>,
    /// Scripted spot-struggle regions.
    #[serde(default)]
    pub forced_spot_struggle_regions: Vec<WasmForcedRegion>,
    /// Scripted forced-rank regions.
    #[serde(default)]
    pub forced_rank: Vec<WasmForcedRank>,
}

impl WasmCreateRunner {
    fn into_domain(self) -> Result<CreateRunner, DtoError> {
        Ok(CreateRunner {
            outfit_id: self.outfit_id,
            name: self.name,
            mood: to_mood(self.mood)?,
            strategy: to_strategy(self.strategy)?,
            popularity: self.popularity,
            aptitudes: self.aptitudes.into_domain()?,
            stats: self.stats.into(),
            skills: self
                .skills
                .into_iter()
                .map(WasmSkillInput::into_domain)
                .collect::<Result<Vec<_>, _>>()?,
            forced_positions: self.forced_positions,
            injected_debuffs: self
                .injected_debuffs
                .into_iter()
                .map(|d| {
                    reject_caster_context_injection(&d.skill)?;
                    Ok::<_, DtoError>(InjectedDebuff {
                        skill: d.skill.into_domain()?,
                        position: d.position,
                    })
                })
                .collect::<Result<Vec<_>, _>>()?,
            forced_rushed_regions: self
                .forced_rushed_regions
                .into_iter()
                .map(|r| ForcedRegion {
                    start: r.start,
                    end: r.end,
                })
                .collect(),
            forced_dueling_regions: self
                .forced_dueling_regions
                .into_iter()
                .map(|r| ForcedRegion {
                    start: r.start,
                    end: r.end,
                })
                .collect(),
            forced_spot_struggle_regions: self
                .forced_spot_struggle_regions
                .into_iter()
                .map(|r| ForcedRegion {
                    start: r.start,
                    end: r.end,
                })
                .collect(),
            forced_rank: self
                .forced_rank
                .into_iter()
                .map(|r| ForcedRank {
                    start: r.start,
                    end: r.end,
                    rank: r.rank,
                })
                .collect(),
        })
    }
}

/// Race-wide parameters.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmRaceParameters {
    /// Ground condition (numeric).
    pub ground: i32,
    /// Weather (numeric).
    pub weather: i32,
    /// Season (numeric).
    pub season: i32,
    /// Time of day (numeric).
    pub time_of_day: i32,
    /// Grade (numeric).
    pub grade: i32,
}

impl WasmRaceParameters {
    fn to_domain(&self) -> Result<RaceParameters, DtoError> {
        Ok(RaceParameters {
            ground: to_ground(self.ground)?,
            weather: to_weather(self.weather)?,
            season: to_season(self.season)?,
            time_of_day: to_time_of_day(self.time_of_day)?,
            grade: to_grade(self.grade)?,
            num_umas: None,
            order_range: None,
            skill_id: None,
            strategy_counts: None,
            common_skills: None,
        })
    }
}

/// Optional simulation toggles (all default to the normal-mode defaults).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmSettings {
    /// Mode string (`"normal"` or `"compare"`).
    #[serde(default)]
    pub mode: Option<String>,
    /// HP system.
    #[serde(default)]
    pub health_system: Option<bool>,
    /// Rushed mechanic.
    #[serde(default)]
    pub rushed: Option<bool>,
    /// Downhill mode.
    #[serde(default)]
    pub downhill: Option<bool>,
    /// Power Conservation / Fully Charged.
    #[serde(default)]
    pub conserve_power: Option<bool>,
    /// Spot struggle.
    #[serde(default)]
    pub spot_struggle: Option<bool>,
    /// Dueling.
    #[serde(default)]
    pub dueling: Option<bool>,
    /// Wit checks.
    #[serde(default)]
    pub wit_checks: Option<bool>,
    /// Skill sample budget.
    #[serde(default)]
    pub skill_samples: Option<usize>,
    /// Per-section wisdom variance.
    #[serde(default)]
    pub section_modifier: Option<bool>,
    /// Position-keep mode (`2` enables virtual position keeping; compare uses `0`).
    #[serde(default)]
    pub position_keep_mode: Option<i32>,
    /// Per-base-skill recovery (stamina-drain) override modifiers.
    #[serde(default)]
    pub stamina_drain_overrides: Option<HashMap<String, f64>>,
}

/// Resolved engine-agnostic toggle values (the `mode` string is ignored: the
/// engine is selected by which entry point is called, not a runtime flag).
struct ResolvedSettings {
    health_system: bool,
    section_modifier: bool,
    rushed: bool,
    downhill: bool,
    conserve_power: bool,
    spot_struggle: bool,
    dueling: bool,
    wit_checks: bool,
    position_keep_mode: i32,
    skill_samples: usize,
    stamina_drain_overrides: HashMap<String, f64>,
}

impl WasmSettings {
    fn resolve(self) -> ResolvedSettings {
        ResolvedSettings {
            health_system: self.health_system.unwrap_or(true),
            section_modifier: self.section_modifier.unwrap_or(true),
            rushed: self.rushed.unwrap_or(true),
            downhill: self.downhill.unwrap_or(true),
            conserve_power: self.conserve_power.unwrap_or(true),
            spot_struggle: self.spot_struggle.unwrap_or(true),
            dueling: self.dueling.unwrap_or(true),
            wit_checks: self.wit_checks.unwrap_or(true),
            position_keep_mode: self.position_keep_mode.unwrap_or(2),
            skill_samples: self.skill_samples.map_or(1, |v| v.max(1)),
            stamina_drain_overrides: self.stamina_drain_overrides.unwrap_or_default(),
        }
    }

    fn into_race_settings(self) -> RaceSettings {
        let r = self.resolve();
        RaceSettings {
            health_system: r.health_system,
            section_modifier: r.section_modifier,
            rushed: r.rushed,
            downhill: r.downhill,
            conserve_power: r.conserve_power,
            spot_struggle: r.spot_struggle,
            dueling: r.dueling,
            wit_checks: r.wit_checks,
            position_keep_mode: r.position_keep_mode,
            skill_samples: r.skill_samples,
            stamina_drain_overrides: r.stamina_drain_overrides,
        }
    }

    fn into_vacuum_settings(self) -> VacuumSettings {
        let r = self.resolve();
        VacuumSettings {
            health_system: r.health_system,
            section_modifier: r.section_modifier,
            rushed: r.rushed,
            downhill: r.downhill,
            conserve_power: r.conserve_power,
            spot_struggle: r.spot_struggle,
            dueling: r.dueling,
            wit_checks: r.wit_checks,
            position_keep_mode: r.position_keep_mode,
            skill_samples: r.skill_samples,
            stamina_drain_overrides: r.stamina_drain_overrides,
        }
    }
}

/// Per-strategy dueling rates (compare-mode artificial dueling).
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmDuelingRates {
    /// Runaway dueling rate.
    pub runaway: f64,
    /// Front-runner dueling rate.
    pub front_runner: f64,
    /// Pace-chaser dueling rate.
    pub pace_chaser: f64,
    /// Late-surger dueling rate.
    pub late_surger: f64,
    /// End-closer dueling rate.
    pub end_closer: f64,
}

impl From<WasmDuelingRates> for DuelingRates {
    fn from(r: WasmDuelingRates) -> Self {
        DuelingRates {
            runaway: r.runaway,
            front_runner: r.front_runner,
            pace_chaser: r.pace_chaser,
            late_surger: r.late_surger,
            end_closer: r.end_closer,
        }
    }
}

/// Inputs to a batch compare-family run.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmCompareParams {
    /// The course.
    pub course: WasmCourseData,
    /// Race parameters.
    pub parameters: WasmRaceParameters,
    /// Optional settings (compare mode toggles).
    #[serde(default)]
    pub settings: WasmSettings,
    /// Optional dueling rates (default: 10 per strategy).
    #[serde(default)]
    pub dueling_rates: Option<WasmDuelingRates>,
    /// The contestants (typically 1 — vacuum race).
    pub runners: Vec<WasmCreateRunner>,
    /// Number of rounds.
    pub nsamples: usize,
    /// Master seed.
    pub master_seed: u64,
}

impl WasmCompareParams {
    /// Convert to the domain [`CompareSimParams`].
    pub fn into_domain(self) -> Result<CompareSimParams, DtoError> {
        let settings = self.settings.into_vacuum_settings();
        let parameters = self.parameters.to_domain()?;
        let ground = to_ground(self.parameters.ground)?;
        let course = self.course.into_domain()?;
        let runners = self
            .runners
            .into_iter()
            .map(WasmCreateRunner::into_domain)
            .collect::<Result<Vec<_>, _>>()?;
        let dueling_rates = match self.dueling_rates {
            Some(r) => r.into(),
            None => DuelingRates {
                runaway: 10.0,
                front_runner: 10.0,
                pace_chaser: 10.0,
                late_surger: 10.0,
                end_closer: 10.0,
            },
        };
        Ok(CompareSimParams {
            course,
            ground,
            parameters,
            settings,
            dueling_rates,
            runners,
            nsamples: self.nsamples,
            master_seed: self.master_seed,
        })
    }
}

/// Inputs to a same-race compare-family run.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmContestedCompareParams {
    /// The course.
    pub course: WasmCourseData,
    /// Race parameters.
    pub parameters: WasmRaceParameters,
    /// Optional settings (contested mechanics toggles).
    #[serde(default)]
    pub settings: WasmSettings,
    /// Compared runners, added first and captured by the compare collector.
    pub runners: Vec<WasmCreateRunner>,
    /// Pad the field with generated mobs to exactly this many runners
    /// (`runners.len()..=12`). Omit for no padding.
    #[serde(default)]
    pub fill_to: Option<usize>,
    /// Deprecated back-compat shim: legacy `fillMobs: true` maps to
    /// `fill_to: Some(9)` when `fillTo` is absent. Retire once the store
    /// plan migrates callers to `fillTo`. `Option` so a present-but-`undefined`
    /// value from the JS boundary deserializes to `None` (serde only applies
    /// `default` to absent keys, not explicit unit values).
    #[serde(default)]
    pub fill_mobs: Option<bool>,
    /// Flat stat line for fill mobs. Omit for the default (600).
    #[serde(default)]
    pub mob_stats: Option<i32>,
    /// Number of rounds.
    pub nsamples: usize,
    /// Master seed.
    pub master_seed: u64,
}

impl WasmContestedCompareParams {
    /// Convert to the domain [`ContestedCompareParams`].
    pub fn into_domain(self) -> Result<ContestedCompareParams, DtoError> {
        let settings = self.settings.into_race_settings();
        let parameters = self.parameters.to_domain()?;
        let ground = to_ground(self.parameters.ground)?;
        let course = self.course.into_domain()?;
        let runners = self
            .runners
            .into_iter()
            .map(WasmCreateRunner::into_domain)
            .collect::<Result<Vec<_>, _>>()?;
        // Legacy `fillMobs: true` → fill to the classic 9-runner field when no
        // explicit `fillTo` is given (back-compat shim, see field docs).
        let fill_to = match (self.fill_to, self.fill_mobs) {
            (Some(n), _) => Some(n),
            (None, Some(true)) => Some(9),
            (None, Some(false) | None) => None,
        };
        Ok(ContestedCompareParams {
            course,
            ground,
            parameters,
            settings,
            runners,
            fill_to,
            mob_stats: self.mob_stats,
            nsamples: self.nsamples,
            master_seed: self.master_seed,
        })
    }
}

/// Inputs to a batch simulation run.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmRaceSimParams {
    /// The course.
    pub course: WasmCourseData,
    /// Race parameters.
    pub parameters: WasmRaceParameters,
    /// Optional settings.
    #[serde(default)]
    pub settings: WasmSettings,
    /// The 9 runners.
    pub runners: Vec<WasmCreateRunner>,
    /// Number of rounds.
    pub nsamples: usize,
    /// Master seed.
    pub master_seed: u64,
    /// Focus runner ids whose telemetry is collected.
    #[serde(default)]
    pub focus_runner_ids: Vec<u32>,
}

impl WasmRaceSimParams {
    /// Convert to the domain [`RaceSimParams`].
    pub fn into_domain(self) -> Result<RaceSimParams, DtoError> {
        let settings = self.settings.into_race_settings();
        let parameters = self.parameters.to_domain()?;
        let ground = to_ground(self.parameters.ground)?;
        let course = self.course.into_domain()?;
        let runners = self
            .runners
            .into_iter()
            .map(WasmCreateRunner::into_domain)
            .collect::<Result<Vec<_>, _>>()?;
        Ok(RaceSimParams {
            course,
            ground,
            parameters,
            settings,
            runners,
            nsamples: self.nsamples,
            master_seed: self.master_seed,
            focus_runner_ids: self.focus_runner_ids.into_iter().map(RunnerId).collect(),
        })
    }
}

// --------- output DTOs ---------

/// A finishing record crossing back to JS.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmFinishEntry {
    /// Runner id.
    pub runner_id: u32,
    /// Display name.
    pub name: String,
    /// Strategy (numeric).
    pub strategy: i32,
    /// Final position.
    pub finish_position: f64,
    /// Finish time in seconds.
    pub finish_time: f64,
}

impl From<&FinishEntry> for WasmFinishEntry {
    fn from(e: &FinishEntry) -> Self {
        WasmFinishEntry {
            runner_id: e.runner_id.0,
            name: e.name.clone(),
            strategy: e.strategy as i32,
            finish_position: e.finish_position,
            finish_time: e.finish_time,
        }
    }
}

/// A per-tick focus sample crossing back to JS.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmTickSample {
    /// Time in seconds.
    pub time: f64,
    /// Position in meters.
    pub position: f64,
    /// Speed in m/s.
    pub speed: f64,
    /// Lane offset.
    pub lane: f64,
    /// Remaining HP.
    pub health: f64,
}

/// A focus runner's trace for a round.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmFocusTrace {
    /// Runner id.
    pub runner_id: u32,
    /// Per-tick samples.
    pub samples: Vec<WasmTickSample>,
    /// Self-cast skill-effect activation logs (`[start, end]` position ranges),
    /// keyed by skill id. Serialized as a JS object (not a Map) via
    /// `serialize_maps_as_objects(true)` in `to_js`.
    pub skill_activations: HashMap<String, Vec<WasmSkillEffectLog>>,
}

/// One round's collected data.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmRoundData {
    /// Round seed.
    pub seed: u64,
    /// Focus traces.
    pub focus: Vec<WasmFocusTrace>,
}

/// Optional detail payload for a logged event.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmRaceEventDetail {
    /// Skill id (skill-activated events).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skill_id: Option<String>,
    /// Other runners sharing the state (dueling / spot-struggle).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub other_runner_ids: Option<Vec<u32>>,
    /// 1-based finishing place (finished events).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finish_place: Option<u32>,
    /// Finish time in seconds (finished events).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finish_time: Option<f64>,
}

/// A logged race event crossing back to JS.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmRaceEvent {
    /// Event kind (kebab-case, matches the TS `RaceEventKind`).
    pub kind: &'static str,
    /// Runner the event is about.
    pub runner_id: u32,
    /// Position in meters.
    pub position: f64,
    /// Tick index (0-based).
    pub tick: i64,
    /// Optional detail payload.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<WasmRaceEventDetail>,
}

/// Map a domain event kind to its TS kebab-case string.
fn log_event_kind_str(kind: RaceLogEventKind) -> &'static str {
    match kind {
        RaceLogEventKind::SkillActivated => "skill-activated",
        RaceLogEventKind::Debuffed => "debuffed",
        RaceLogEventKind::Rushed => "rushed",
        RaceLogEventKind::RushedEnd => "rushed-end",
        RaceLogEventKind::DuelingStart => "dueling-start",
        RaceLogEventKind::DuelingEnd => "dueling-end",
        RaceLogEventKind::SpotStruggleStart => "spot-struggle-start",
        RaceLogEventKind::SpotStruggleEnd => "spot-struggle-end",
        RaceLogEventKind::FullyCharged => "fully-charged",
        RaceLogEventKind::FullyChargedEnd => "fully-charged-end",
        RaceLogEventKind::LastSpurt => "last-spurt",
        RaceLogEventKind::HpOut => "hp-out",
        RaceLogEventKind::Finished => "finished",
        RaceLogEventKind::PaceDownStart => "pace-down-start",
        RaceLogEventKind::PaceDownEnd => "pace-down-end",
        RaceLogEventKind::PaceUpStart => "pace-up-start",
        RaceLogEventKind::PaceUpEnd => "pace-up-end",
        RaceLogEventKind::PaceUpExStart => "pace-up-ex-start",
        RaceLogEventKind::PaceUpExEnd => "pace-up-ex-end",
        RaceLogEventKind::OvertakeStart => "overtake-start",
        RaceLogEventKind::OvertakeEnd => "overtake-end",
        RaceLogEventKind::BlockedSideStart => "blocked-side-start",
        RaceLogEventKind::BlockedSideEnd => "blocked-side-end",
        RaceLogEventKind::MidRaceStart => "mid-race-start",
        RaceLogEventKind::LateRaceStart => "late-race-start",
    }
}

impl From<&RaceLogEvent> for WasmRaceEvent {
    fn from(e: &RaceLogEvent) -> Self {
        let detail = e.detail.as_ref().map(|d| WasmRaceEventDetail {
            skill_id: d.skill_id.clone(),
            other_runner_ids: if d.other_runner_ids.is_empty() {
                None
            } else {
                Some(d.other_runner_ids.iter().map(|id| id.0).collect())
            },
            finish_place: d.finish_place,
            finish_time: d.finish_time,
        });
        WasmRaceEvent {
            kind: log_event_kind_str(e.kind),
            runner_id: e.runner_id.0,
            position: e.position,
            tick: e.tick,
            detail,
        }
    }
}

fn event_logs_to_wasm(logs: &RaceEventLog) -> Vec<Vec<WasmRaceEvent>> {
    logs.iter()
        .map(|round| round.iter().map(WasmRaceEvent::from).collect())
        .collect()
}

/// The serialized simulation result.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmRaceSimResult {
    /// Per-round finish orders.
    pub finish_orders: Vec<Vec<WasmFinishEntry>>,
    /// Collected focus telemetry.
    pub collected: Vec<WasmRoundData>,
    /// Per-round logged race events.
    pub event_logs: Vec<Vec<WasmRaceEvent>>,
}

impl WasmRaceSimResult {
    /// Build the output DTO from a domain result.
    pub fn from_domain(result: &RaceSimResult) -> Self {
        WasmRaceSimResult {
            finish_orders: result
                .finish_orders
                .iter()
                .map(|order| order.iter().map(WasmFinishEntry::from).collect())
                .collect(),
            collected: collected_to_wasm(&result.collected),
            event_logs: event_logs_to_wasm(&result.event_logs),
        }
    }
}

fn collected_to_wasm(data: &CollectedData) -> Vec<WasmRoundData> {
    data.rounds
        .iter()
        .map(|round| WasmRoundData {
            seed: round.seed,
            focus: round
                .focus
                .iter()
                .map(|trace| WasmFocusTrace {
                    runner_id: trace.runner_id.0,
                    samples: trace
                        .samples
                        .iter()
                        .map(|s| WasmTickSample {
                            time: s.time,
                            position: s.position,
                            speed: s.speed,
                            lane: s.lane,
                            health: s.health,
                        })
                        .collect(),
                    skill_activations: skill_activation_map_to_wasm(&trace.skill_activations),
                })
                .collect(),
        })
        .collect()
}

// --------- compare output DTOs ---------

/// One activation of a skill effect tracked as a `[start, end]` position range.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmSkillEffectLog {
    /// Unique id for this activation within the round.
    pub execution_id: String,
    /// Skill id that produced the effect.
    pub skill_id: String,
    /// Position where the effect began.
    pub start: f64,
    /// Position where the effect ended.
    pub end: f64,
    /// Perspective (1 = self, 2 = other), matching TS `SkillPerspective`.
    pub perspective: i32,
    /// Effect type discriminant.
    pub effect_type: i32,
    /// Effect target discriminant.
    pub effect_target: i32,
}

impl From<&SkillEffectLog> for WasmSkillEffectLog {
    fn from(log: &SkillEffectLog) -> Self {
        WasmSkillEffectLog {
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

fn skill_activation_map_to_wasm(
    map: &HashMap<String, Vec<SkillEffectLog>>,
) -> HashMap<String, Vec<WasmSkillEffectLog>> {
    map.iter()
        .map(|(k, logs)| {
            (
                k.clone(),
                logs.iter().map(WasmSkillEffectLog::from).collect(),
            )
        })
        .collect()
}

/// Rich per-runner, per-round compare data crossing back to JS.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmCompareRoundData {
    /// Runner id.
    pub runner_id: u32,
    /// Per-tick elapsed time.
    pub time: Vec<f64>,
    /// Per-tick position.
    pub position: Vec<f64>,
    /// Per-tick velocity.
    pub velocity: Vec<f64>,
    /// Per-tick HP.
    pub hp: Vec<f64>,
    /// Per-tick lane.
    pub current_lane: Vec<f64>,
    /// Per-tick gap to the pacer.
    pub pacer_gap: Vec<f64>,
    /// Per-tick race order (1-based rank; 0 when untracked).
    pub order: Vec<i64>,
    /// Self-cast skill-effect activation logs, keyed by skill id.
    pub skill_activations: HashMap<String, Vec<WasmSkillEffectLog>>,
    /// Externally-targeted skill-effect activation logs, keyed by skill id.
    pub targeted_skill_activations: HashMap<String, Vec<WasmSkillEffectLog>>,
    /// Start delay in seconds.
    pub start_delay: f64,
    /// Closed rushed regions as `[start, end]` pairs.
    pub rushed: Vec<[f64; 2]>,
    /// Dueling region, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dueling_region: Option<[f64; 2]>,
    /// Spot-struggle region, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spot_struggle_region: Option<[f64; 2]>,
    /// Fully Charged release region, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fully_charged_region: Option<[f64; 2]>,
    /// Fully Charged acceleration bonus, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fully_charged_accel: Option<f64>,
    /// Whether a full last spurt was achieved.
    pub has_achieved_full_spurt: bool,
    /// Whether HP ran out.
    pub out_of_hp: bool,
    /// Distance-remaining when HP ran out.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub out_of_hp_position: Option<f64>,
    /// Velocity shortfall when the last spurt was not full.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub non_full_spurt_velocity_diff: Option<f64>,
    /// Delay distance when the last spurt was not full.
    #[serde(skip_serializing_if = "Option::is_none")]
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

impl From<&CompareRoundData> for WasmCompareRoundData {
    fn from(d: &CompareRoundData) -> Self {
        WasmCompareRoundData {
            runner_id: d.runner_id,
            time: d.time.clone(),
            position: d.position.clone(),
            velocity: d.velocity.clone(),
            hp: d.hp.clone(),
            current_lane: d.current_lane.clone(),
            pacer_gap: d.pacer_gap.clone(),
            order: d.order.clone(),
            skill_activations: skill_activation_map_to_wasm(&d.skill_activations),
            targeted_skill_activations: skill_activation_map_to_wasm(&d.targeted_skill_activations),
            start_delay: d.start_delay,
            rushed: d.rushed.iter().map(|&(s, e)| [s, e]).collect(),
            dueling_region: d.dueling_region.map(|(s, e)| [s, e]),
            spot_struggle_region: d.spot_struggle_region.map(|(s, e)| [s, e]),
            fully_charged_region: d.fully_charged_region.map(|(s, e)| [s, e]),
            fully_charged_accel: d.fully_charged_accel,
            has_achieved_full_spurt: d.has_achieved_full_spurt,
            out_of_hp: d.out_of_hp,
            out_of_hp_position: d.out_of_hp_position,
            non_full_spurt_velocity_diff: d.non_full_spurt_velocity_diff,
            non_full_spurt_delay_distance: d.non_full_spurt_delay_distance,
            first_position_in_late_race: d.first_position_in_late_race,
            used_skills: d.used_skills.clone(),
            finished: d.finished,
            finish_position: d.finish_position,
        }
    }
}

/// One round's compare data crossing back to JS.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmCompareRound {
    /// Master seed.
    pub seed: u64,
    /// The primary (first-added) runner's id, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primary_runner_id: Option<u32>,
    /// Per-runner round data.
    pub runners: Vec<WasmCompareRoundData>,
}

/// The serialized compare result (per-round, per-runner telemetry).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmCompareData {
    /// One entry per simulated round.
    pub rounds: Vec<WasmCompareRound>,
}

impl WasmCompareData {
    /// Build the output DTO from a domain [`CompareData`].
    pub fn from_domain(data: &CompareData) -> Self {
        WasmCompareData {
            rounds: data
                .rounds
                .iter()
                .map(|round| WasmCompareRound {
                    seed: round.seed,
                    primary_runner_id: round.primary_runner_id,
                    runners: round
                        .runners
                        .iter()
                        .map(WasmCompareRoundData::from)
                        .collect(),
                })
                .collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uma_sim_primitives::skills::model::build_skill_effects;

    #[test]
    fn wasm_skill_input_carries_tags_and_defaults_missing_tags() {
        let tagged: WasmSkillInput = serde_json::from_str(
            r#"{
                "skillId": "200011",
                "rarity": 1,
                "tags": [401, 608],
                "alternatives": []
            }"#,
        )
        .expect("tagged skill input deserializes");
        assert_eq!(
            tagged
                .into_domain()
                .expect("tagged skill input converts")
                .tags,
            vec![401, 608]
        );

        let legacy: WasmSkillInput = serde_json::from_str(
            r#"{
                "skillId": "200011",
                "rarity": 1,
                "alternatives": []
            }"#,
        )
        .expect("legacy skill input deserializes");
        assert!(legacy
            .into_domain()
            .expect("legacy skill input converts")
            .tags
            .is_empty());
    }

    #[test]
    fn skill_input_accepts_direct_unmodeled_effect_and_preserves_modeled_effects() {
        // Pace Chaser Savvy ○ (201532) bundles its modeled Wisdom Up effect
        // (type 5) with a Direct vision effect (type 8) that the engine does
        // not model. The DTO must admit the supported Direct policy so the
        // domain can intentionally drop only the unmodeled effect.
        let dto: WasmSkillInput = serde_json::from_str(
            r#"{
                "skillId": "201532",
                "rarity": 1,
                "alternatives": [{
                    "baseDuration": -1,
                    "condition": "running_style==2",
                    "effects": [
                        { "modifier": 400000, "target": 1, "type": 5, "valueUsage": 1, "valueLevelUsage": 1 },
                        { "modifier": 50000, "target": 1, "type": 8, "valueUsage": 1, "valueLevelUsage": 1 }
                    ]
                }]
            }"#,
        )
        .expect("skill input deserializes");

        let skill = dto.into_domain().expect("201532-shaped skill converts");
        let effects = build_skill_effects(&skill.alternatives[0]);
        assert_eq!(effects.len(), 1, "the unmodeled vision effect is skipped");
        assert_eq!(
            effects[0].effect_type,
            uma_sim_primitives::skills::effect::SkillType::WisdomUp
        );
        assert_eq!(effects[0].modifier, 40.0);
    }

    #[test]
    fn skill_input_rejects_unsupported_value_usage_with_coordinates() {
        // Usage 10 (Climax) is still unsupported and must reject with coordinates.
        let dto: WasmSkillInput = serde_json::from_str(
            r#"{
                "skillId": "210061",
                "rarity": 3,
                "alternatives": [{
                    "baseDuration": 50000,
                    "condition": "phase>=2",
                    "effects": [
                        { "modifier": 2500, "target": 1, "type": 27, "valueUsage": 1 },
                        { "modifier": 500, "target": 1, "type": 27, "valueUsage": 10 }
                    ]
                }]
            }"#,
        )
        .expect("skill input deserializes");

        assert_eq!(
            dto.into_domain(),
            Err(DtoError(
                "skill 210061 alternative 0 effect 1: unsupported value usage 10".to_owned()
            ))
        );
    }

    #[test]
    fn skill_input_accepts_copano_rickey_mixed_direct_and_usage_14() {
        // Copano Rickey's Luck Runs My Way (100981): one Direct Target Speed plus
        // a usage-14 Target Speed and a usage-14 Acceleration. Usage 14 is a
        // supported cast-skill policy, so the whole skill converts.
        let dto: WasmSkillInput = serde_json::from_str(
            r#"{
                "skillId": "100981",
                "rarity": 5,
                "alternatives": [{
                    "baseDuration": 50000,
                    "condition": "phase>=2",
                    "effects": [
                        { "modifier": 2500, "target": 1, "type": 27, "valueUsage": 1 },
                        { "modifier": 500, "target": 1, "type": 27, "valueUsage": 14 },
                        { "modifier": 500, "target": 1, "type": 31, "valueUsage": 14 }
                    ]
                }]
            }"#,
        )
        .expect("skill input deserializes");

        let skill = dto.into_domain().expect("usage 14 cast skill converts");
        assert_eq!(skill.alternatives[0].effects.len(), 3);
    }

    #[test]
    fn skill_input_rejects_alternative_mixing_direct_and_usage_13() {
        let dto: WasmSkillInput = serde_json::from_str(
            r#"{
                "skillId": "210081",
                "rarity": 3,
                "alternatives": [{
                    "baseDuration": 30000,
                    "condition": "phase>=2",
                    "effects": [
                        { "modifier": 500, "target": 1, "type": 27, "valueUsage": 1 },
                        { "modifier": 500, "target": 1, "type": 27, "valueUsage": 13 }
                    ]
                }]
            }"#,
        )
        .expect("skill input deserializes");

        assert_eq!(
            dto.into_domain(),
            Err(DtoError(
                "skill 210081 alternative 0 effect 1: unsupported value usage 13".to_owned()
            ))
        );
    }

    #[test]
    fn skill_input_rejects_non_recovery_multiply_random_and_later_alternatives() {
        let dto: WasmSkillInput = serde_json::from_str(
            r#"{
                "skillId": "test-skill",
                "rarity": 1,
                "alternatives": [
                    {
                        "baseDuration": 10000,
                        "condition": "phase>=2",
                        "effects": [{ "modifier": 500, "target": 1, "type": 27, "valueUsage": 1 }]
                    },
                    {
                        "baseDuration": 10000,
                        "condition": "phase>=3",
                        "effects": [{ "modifier": 500, "target": 1, "type": 27, "valueUsage": 8 }]
                    }
                ]
            }"#,
        )
        .expect("skill input deserializes");

        assert_eq!(
            dto.into_domain(),
            Err(DtoError(
                "skill test-skill alternative 1 effect 0: value usage 8 is invalid for effect type 27"
                    .to_owned()
            ))
        );
    }

    #[test]
    fn injected_debuff_accepts_receiver_local_recovery_multiply_random() {
        // An injected external Recovery drain with usage 8 has no caster; it is
        // resolved receiver-locally, so the caster-context guard accepts it.
        let skill: WasmSkillInput = serde_json::from_str(
            r#"{
                "skillId": "202031",
                "rarity": 1,
                "alternatives": [{
                    "baseDuration": 10000,
                    "condition": "phase>=2",
                    "effects": [
                        { "modifier": -10000, "target": 2, "type": 9, "valueUsage": 8 }
                    ]
                }]
            }"#,
        )
        .expect("skill input deserializes");
        assert_eq!(reject_caster_context_injection(&skill), Ok(()));
    }

    #[test]
    fn injected_debuff_rejects_caster_context_usage_14() {
        let skill: WasmSkillInput = serde_json::from_str(
            r#"{
                "skillId": "100981",
                "rarity": 5,
                "alternatives": [{
                    "baseDuration": 50000,
                    "condition": "phase>=2",
                    "effects": [
                        { "modifier": 500, "target": 1, "type": 27, "valueUsage": 14 }
                    ]
                }]
            }"#,
        )
        .expect("skill input deserializes");
        assert_eq!(
            reject_caster_context_injection(&skill),
            Err(DtoError(
                "injected debuff 100981 alternative 0 effect 0: value usage 14 requires caster context and cannot be injected"
                    .to_owned()
            ))
        );
    }

    #[test]
    fn skill_input_accepts_direct_and_recovery_multiply_random() {
        let dto: WasmSkillInput = serde_json::from_str(
            r#"{
                "skillId": "202031",
                "rarity": 1,
                "alternatives": [{
                    "baseDuration": 10000,
                    "condition": "phase>=2",
                    "effects": [
                        { "modifier": 500, "target": 1, "type": 27, "valueUsage": 1 },
                        { "modifier": -10000, "target": 1, "type": 9, "valueUsage": 8 }
                    ]
                }]
            }"#,
        )
        .expect("skill input deserializes");

        assert!(dto.into_domain().is_ok());
    }

    #[test]
    fn contested_compare_params_deserialize_into_domain() {
        let dto: WasmContestedCompareParams = serde_json::from_str(
            r#"{
                "course": {
                    "courseId": 10101,
                    "raceTrackId": 101,
                    "distance": 2000.0,
                    "distanceType": 3,
                    "surface": 1,
                    "turn": 2,
                    "courseSetStatus": [1, 2],
                    "corners": [{ "start": 400.0, "length": 100.0 }],
                    "straights": [{ "start": 0.0, "end": 400.0 }],
                    "slopes": [{ "start": 900.0, "length": 50.0, "slope": -1.5 }],
                    "laneMax": 18.0,
                    "courseWidth": 30.0,
                    "horseLane": 1.2,
                    "laneChangeAcceleration": 0.1,
                    "laneChangeAccelerationPerFrame": 0.01,
                    "maxLaneDistance": 2.0,
                    "moveLanePoint": 0.5,
                    "isAbroad": false
                },
                "parameters": {
                    "ground": 1,
                    "weather": 1,
                    "season": 1,
                    "timeOfDay": 1,
                    "grade": 100
                },
                "settings": {
                    "spotStruggle": true,
                    "dueling": false,
                    "positionKeepMode": 2
                },
                "runners": [
                    {
                        "outfitId": "test-outfit",
                        "name": "Alpha",
                        "mood": 0,
                        "strategy": 1,
                        "aptitudes": { "distance": 1, "strategy": 1, "surface": 1 },
                        "stats": { "speed": 900, "stamina": 800, "power": 700, "guts": 600, "wit": 500 },
                        "forcedSpotStruggleRegions": [{ "start": 200.0, "end": 260.0 }]
                    },
                    {
                        "outfitId": "test-outfit",
                        "name": "Beta",
                        "mood": 0,
                        "strategy": 1,
                        "aptitudes": { "distance": 1, "strategy": 1, "surface": 1 },
                        "stats": { "speed": 900, "stamina": 800, "power": 700, "guts": 600, "wit": 500 },
                        "forcedSpotStruggleRegions": [{ "start": 200.0, "end": 260.0 }]
                    }
                ],
                "fillMobs": true,
                "nsamples": 7,
                "masterSeed": 42
            }"#,
        )
        .expect("contested compare params deserialize");

        let domain = dto.into_domain().expect("params convert to domain");

        assert_eq!(domain.course.course_id, 10101);
        assert_eq!(domain.runners.len(), 2);
        assert_eq!(domain.runners[0].name, "Alpha");
        assert_eq!(domain.runners[0].forced_spot_struggle_regions.len(), 1);
        // Legacy `fillMobs: true` maps to the classic 9-runner fill.
        assert_eq!(domain.fill_to, Some(9));
        assert_eq!(domain.nsamples, 7);
        assert_eq!(domain.master_seed, 42);
        assert!(domain.settings.spot_struggle);
        assert!(!domain.settings.dueling);
    }

    fn minimal_contested_json(fill_fields: &str) -> String {
        format!(
            r#"{{
                "course": {{
                    "courseId": 10101,
                    "raceTrackId": 101,
                    "distance": 2000.0,
                    "distanceType": 3,
                    "surface": 1,
                    "turn": 2,
                    "laneMax": 18.0,
                    "courseWidth": 30.0,
                    "horseLane": 1.2,
                    "laneChangeAcceleration": 0.1,
                    "laneChangeAccelerationPerFrame": 0.01,
                    "maxLaneDistance": 2.0,
                    "moveLanePoint": 0.5
                }},
                "parameters": {{
                    "ground": 1,
                    "weather": 1,
                    "season": 1,
                    "timeOfDay": 1,
                    "grade": 100
                }},
                "runners": [
                    {{
                        "outfitId": "test-outfit",
                        "name": "Alpha",
                        "mood": 0,
                        "strategy": 1,
                        "aptitudes": {{ "distance": 1, "strategy": 1, "surface": 1 }},
                        "stats": {{ "speed": 900, "stamina": 800, "power": 700, "guts": 600, "wit": 500 }}
                    }},
                    {{
                        "outfitId": "test-outfit",
                        "name": "Beta",
                        "mood": 0,
                        "strategy": 1,
                        "aptitudes": {{ "distance": 1, "strategy": 1, "surface": 1 }},
                        "stats": {{ "speed": 900, "stamina": 800, "power": 700, "guts": 600, "wit": 500 }}
                    }}
                ],{fill_fields}
                "nsamples": 1,
                "masterSeed": 1
            }}"#
        )
    }

    #[test]
    fn contested_compare_fill_to_passes_through() {
        let dto: WasmContestedCompareParams =
            serde_json::from_str(&minimal_contested_json(r#" "fillTo": 12,"#))
                .expect("contested compare params deserialize with fillTo");
        let domain = dto.into_domain().expect("params convert to domain");
        assert_eq!(domain.fill_to, Some(12));
        // mobStats omitted -> engine default (600).
        assert_eq!(domain.mob_stats, None);
    }

    #[test]
    fn contested_compare_mob_stats_passes_through() {
        let dto: WasmContestedCompareParams =
            serde_json::from_str(&minimal_contested_json(r#" "fillTo": 9, "mobStats": 700,"#))
                .expect("contested compare params deserialize with mobStats");
        let domain = dto.into_domain().expect("params convert to domain");
        assert_eq!(domain.mob_stats, Some(700));
    }

    #[test]
    fn contested_compare_fill_to_wins_over_legacy_fill_mobs() {
        let dto: WasmContestedCompareParams = serde_json::from_str(&minimal_contested_json(
            r#" "fillTo": 11, "fillMobs": true,"#,
        ))
        .expect("contested compare params deserialize with both fill fields");
        let domain = dto.into_domain().expect("params convert to domain");
        assert_eq!(domain.fill_to, Some(11));
    }

    #[test]
    fn contested_compare_fill_mobs_defaults_false() {
        let dto: WasmContestedCompareParams = serde_json::from_str(
            r#"{
                "course": {
                    "courseId": 10101,
                    "raceTrackId": 101,
                    "distance": 2000.0,
                    "distanceType": 3,
                    "surface": 1,
                    "turn": 2,
                    "laneMax": 18.0,
                    "courseWidth": 30.0,
                    "horseLane": 1.2,
                    "laneChangeAcceleration": 0.1,
                    "laneChangeAccelerationPerFrame": 0.01,
                    "maxLaneDistance": 2.0,
                    "moveLanePoint": 0.5
                },
                "parameters": {
                    "ground": 1,
                    "weather": 1,
                    "season": 1,
                    "timeOfDay": 1,
                    "grade": 100
                },
                "runners": [
                    {
                        "outfitId": "test-outfit",
                        "name": "Alpha",
                        "mood": 0,
                        "strategy": 1,
                        "aptitudes": { "distance": 1, "strategy": 1, "surface": 1 },
                        "stats": { "speed": 900, "stamina": 800, "power": 700, "guts": 600, "wit": 500 }
                    },
                    {
                        "outfitId": "test-outfit",
                        "name": "Beta",
                        "mood": 0,
                        "strategy": 1,
                        "aptitudes": { "distance": 1, "strategy": 1, "surface": 1 },
                        "stats": { "speed": 900, "stamina": 800, "power": 700, "guts": 600, "wit": 500 }
                    }
                ],
                "nsamples": 1,
                "masterSeed": 1
            }"#,
        )
        .expect("contested compare params deserialize with default fillMobs");

        assert_eq!(dto.fill_mobs, None);
        assert_eq!(dto.fill_to, None);
        let domain = dto.into_domain().expect("params convert to domain");
        assert_eq!(domain.fill_to, None);
    }
}
