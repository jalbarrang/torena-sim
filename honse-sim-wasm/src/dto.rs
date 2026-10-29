//! serde boundary DTOs and their conversions to/from domain value objects.
//!
//! This is the **anti-corruption layer**: the JS side speaks numeric enums and
//! camelCase keys; the domain speaks name-based enums and snake_case. All that
//! translation lives here so the core stays serde-light. Conversions are
//! fallible (`Result<_, DtoError>`) — invalid enum codes are reported, never
//! panicked.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use wasm_bindgen::{JsError, JsValue};

use crate::to_js;

use honse_sim::compare::{BasinRound, BasinRoundData, PositionRound, PositionRoundData};
use honse_sim::contested::collectors::{
    CollectedData, RaceEventLog, RaceLogEvent, RaceLogEventKind,
};
use honse_sim::contested::simulation::{
    ContestedCompareParams, FinishEntry, RaceReplayParams, RaceSimParams, RaceSimResult,
};
use honse_sim::contested::SimulationSettings as RaceSettings;
use honse_sim::course::model::{Corner, CourseData, Slope, Straight};
use honse_sim::projection::{EffectPerspective, SkillEffectLog};
use honse_sim::readouts::{StaminaBudget, StaminaBudgetInput};
use honse_sim::runner::lifecycle::{CreateRunner, RunnerAptitudes};
use honse_sim::runner::mechanics::DuelingRates;
use honse_sim::runner::{ForcedRank, ForcedRegion, InjectedDebuff};
use honse_sim::shared_kernel::ids::{RunnerId, SkillId};
use honse_sim::shared_kernel::language::{
    Aptitude, DistanceType, Grade, GroundCondition, Mood, Orientation, Season, Strategy, Surface,
    ThresholdStat, TimeOfDay, Weather,
};
use honse_sim::shared_kernel::params::{RaceParameters, StatLine};
use honse_sim::skill_bashin::{EvaluationWindow, FallbackEffect};
use honse_sim::skills::effect::{SkillRarity, SkillTarget};
use honse_sim::skills::level_scaling::MAX_SKILL_LEVEL;
use honse_sim::skills::model::{RawSkillEffect, Skill, SkillAlternative};
use honse_sim::skills::value_scaling::ValueScalingPolicy;
use honse_sim::stamina::ledger::StaminaLedger;
use honse_sim::vacuum::collectors::{BasinData, CompareData, CompareRoundData, PositionData};
use honse_sim::vacuum::ranking::{RankCandidate, SkillRankData, SkillRankParams};
use honse_sim::vacuum::simulation::CompareSimParams;
use honse_sim::vacuum::SimulationSettings as VacuumSettings;

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

/// Map a raw target code, or `None` when the engine has no routing for it.
///
/// `None` drops the effect rather than failing the skill: an unmapped target
/// means "we do not know who receives this", which is the same kind of gap as an
/// unmapped effect type ("what it does") or value usage ("how much"). Inventing
/// a route would be worse than omitting the effect. This is the only place a
/// target code is interpreted, so it is the authority the support report reads.
fn map_target(v: i32) -> Option<SkillTarget> {
    match v {
        // The source data uses 0 for plain self-targeted effects.
        0..=1 => Some(SkillTarget::SelfTarget),
        2 => Some(SkillTarget::All),
        4 => Some(SkillTarget::InFov),
        7 => Some(SkillTarget::AheadOfPosition),
        9 => Some(SkillTarget::AheadOfSelf),
        10 => Some(SkillTarget::BehindSelf),
        11 => Some(SkillTarget::AllAllies),
        18 => Some(SkillTarget::EnemyStrategy),
        19 => Some(SkillTarget::KakariAhead),
        20 => Some(SkillTarget::KakariBehind),
        21 => Some(SkillTarget::KakariStrategy),
        22 => Some(SkillTarget::UmaId),
        23 => Some(SkillTarget::UsedRecovery),
        _ => None,
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
    /// The value-scaling tier multiplier already applied to `modifier`, when the
    /// data layer applied one.
    ///
    /// Required for the tiered usages (2, 3-7, 10, 12, 13, 24); ignored
    /// otherwise. Pre-application is gated per *skill* upstream, not per usage,
    /// so the engine cannot infer it from `valueUsage` — an effect that omits
    /// this is dropped rather than assumed, and reported as
    /// `missingPreAppliedMultiplier`.
    #[serde(default)]
    pub pre_applied_multiplier: Option<f64>,
}

impl WasmRawEffect {
    /// `None` when the target code has no engine routing, which drops the effect.
    fn to_domain(&self) -> Option<RawSkillEffect> {
        Some(RawSkillEffect {
            modifier: self.modifier,
            target: map_target(self.target)?,
            effect_type: self.effect_type,
            value_usage: self.value_usage,
            value_level_usage: self.value_level_usage,
            pre_applied_multiplier: self.pre_applied_multiplier,
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
    /// Skill level (`1..=10`). Omitted/`null` = 1, the unscaled row. Must stay
    /// `Option` so a present-but-`undefined` key deserializes to `None`.
    #[serde(default)]
    pub level: Option<u8>,
    /// `skill_data.activate_lot`: `Some(1)` rolls the pre-race wit lottery,
    /// `Some(0)` is guaranteed eligible. `None` = master data did not describe
    /// this skill, so the engine keeps its effect-type heuristic.
    #[serde(default)]
    pub activate_lot: Option<i32>,
    /// Condition branches.
    pub alternatives: Vec<WasmSkillAlternative>,
}

fn to_skill_level(v: Option<u8>) -> Result<u8, DtoError> {
    match v {
        None => Ok(1),
        Some(level) if (1..=MAX_SKILL_LEVEL).contains(&level) => Ok(level),
        Some(level) => Err(invalid("skill level", i32::from(level))),
    }
}

impl WasmSkillInput {
    fn into_domain(self) -> Result<Skill, DtoError> {
        let skill_id = self.skill_id;
        let level = to_skill_level(self.level)?;
        let alternatives = self
            .alternatives
            .into_iter()
            .enumerate()
            .map(|(alternative_index, alternative)| {
                let mut effects = Vec::with_capacity(alternative.effects.len());
                for (effect_index, effect) in alternative.effects.iter().enumerate() {
                    // Target first: an effect the engine cannot route is dropped
                    // before anything else inspects it, so a dropped effect can
                    // never fail the payload it was dropped from.
                    let Some(raw) = effect.to_domain() else {
                        continue;
                    };
                    validate_effect_value_usage(
                        &skill_id,
                        alternative_index,
                        effect_index,
                        effect,
                    )?;
                    effects.push(raw);
                }
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
            activate_lot: self.activate_lot,
            level,
            alternatives,
        })
    }
}

/// Reject an effect whose value scaling contradicts its effect type.
///
/// Deliberately *not* fatal: an unsupported `value_usage`. That is a coverage
/// gap, and `build_skill_effects` already drops exactly that one effect while the
/// rest of the skill simulates — the same degradation an unmodeled effect type
/// gets. Failing the conversion instead rejected the whole payload, so a single
/// unmodeled usage anywhere in a skill pool took every other skill down with it
/// (and a runner whose unique carries one could never be simulated at all). The
/// `skillSupportReport` export reports what was dropped so the gap is visible
/// rather than silent.
///
/// Still fatal: a *supported* usage on an effect type it cannot scale (e.g.
/// Recovery-only `MultiplyRandom` on a Target Speed effect). That is data
/// contradicting itself rather than a gap in our modeling, and dropping the
/// effect would paper over it. Only checked for types the engine models, since
/// unmodeled types are dropped regardless.
fn validate_effect_value_usage(
    skill_id: &str,
    alternative_index: usize,
    effect_index: usize,
    effect: &WasmRawEffect,
) -> Result<(), DtoError> {
    let Ok(policy) = ValueScalingPolicy::from_value_usage(effect.value_usage) else {
        return Ok(());
    };
    if let Ok(effect_type) = honse_sim::skills::effect::SkillType::try_from(effect.effect_type) {
        if !policy.supports_effect_type(effect_type) {
            return Err(DtoError(format!(
                "skill {skill_id} alternative {alternative_index} effect {effect_index}: value usage {} is invalid for effect type {}",
                effect.value_usage.unwrap_or(1),
                effect.effect_type
            )));
        }
    }
    Ok(())
}

/// Why one effect is not simulated.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WasmUnmodeledReason {
    /// The effect's raw `type` id has no engine mapping — what it does is
    /// unknown.
    UnmodeledEffectType,
    /// The effect's `valueUsage` has no engine mapping — how much it does is
    /// unknown.
    UnsupportedValueUsage,
    /// The effect's `target` code has no engine mapping — who receives it is
    /// unknown.
    UnmodeledTarget,
    /// The effect uses a tiered `valueUsage` but did not state the
    /// `preAppliedMultiplier` already folded into its modifier, so which tier it
    /// carries is unknown. Fixed by the data stating the multiplier, not by the
    /// engine adding a policy.
    MissingPreAppliedMultiplier,
}

/// One effect the engine drops, located in the submitted skill payload.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmDroppedEffect {
    /// Index into the skill's `alternatives`.
    pub alternative_index: usize,
    /// Index into that alternative's `effects`.
    pub effect_index: usize,
    /// Which mapping was missing.
    pub reason: WasmUnmodeledReason,
    /// The unmapped raw value, per `reason`: the effect `type` id, the
    /// `valueUsage`, or the `target` code.
    pub value: i32,
}

/// A submitted skill the engine models only partially.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmSkillSupportEntry {
    /// Skill id as submitted.
    pub skill_id: String,
    /// Every dropped effect across all alternatives. Never empty — fully modeled
    /// skills are omitted from the report entirely.
    pub dropped_effects: Vec<WasmDroppedEffect>,
    /// No alternative retains a modeled effect, so the skill converts but can
    /// never affect a race. Distinguishes "lost one component" (a modifier is
    /// understated) from "inert" (the skill is decoration), which a consumer
    /// will usually want to surface differently.
    pub fully_unmodeled: bool,
}

/// Report which of `skills` the engine models only partially, and what it drops.
///
/// A pure query over the skill data — the answer depends on the payload alone,
/// not on any race — so a consumer can call it once when it loads a skill pool
/// and cache the result rather than re-deriving it per simulation.
///
/// Fully modeled skills are omitted, so an empty result means full coverage.
/// Errors only on the same contradictory data a simulation would reject.
///
/// Classification runs over the *submitted* effects rather than the converted
/// ones, so every `effectIndex` addresses the payload the caller sent even where
/// conversion dropped an earlier effect in the same alternative.
pub fn build_skill_support_report(
    skills: &[WasmSkillInput],
) -> Result<Vec<WasmSkillSupportEntry>, DtoError> {
    use honse_sim::skills::model::{build_skill_effects, unmodeled_effects, UnmodeledEffect};

    let mut report = Vec::new();
    for input in skills {
        let mut dropped_effects = Vec::new();
        let mut modeled = 0usize;

        for (alternative_index, alternative) in input.alternatives.iter().enumerate() {
            // Mirrors `into_domain`: targets resolve here, so an unroutable
            // effect never reaches the core classifier. Keep the raw positions of
            // the survivors to translate the core's indices back afterwards.
            let mut kept_raw_indices = Vec::with_capacity(alternative.effects.len());
            let mut kept = Vec::with_capacity(alternative.effects.len());
            for (effect_index, effect) in alternative.effects.iter().enumerate() {
                let Some(raw) = effect.to_domain() else {
                    dropped_effects.push(WasmDroppedEffect {
                        alternative_index,
                        effect_index,
                        reason: WasmUnmodeledReason::UnmodeledTarget,
                        value: effect.target,
                    });
                    continue;
                };
                validate_effect_value_usage(
                    &input.skill_id,
                    alternative_index,
                    effect_index,
                    effect,
                )?;
                kept_raw_indices.push(effect_index);
                kept.push(raw);
            }

            let domain = SkillAlternative {
                base_duration: alternative.base_duration,
                cooldown_time: alternative.cooldown_time,
                condition: alternative.condition.clone(),
                precondition: alternative.precondition.clone(),
                effects: kept,
            };
            modeled += build_skill_effects(&domain, input.level.unwrap_or(1)).len();
            for (domain_index, reason) in unmodeled_effects(&domain) {
                let (reason, value) = match reason {
                    UnmodeledEffect::EffectType(id) => {
                        (WasmUnmodeledReason::UnmodeledEffectType, id)
                    }
                    UnmodeledEffect::ValueUsage(usage) => {
                        (WasmUnmodeledReason::UnsupportedValueUsage, usage)
                    }
                    UnmodeledEffect::MissingPreAppliedMultiplier(usage) => {
                        (WasmUnmodeledReason::MissingPreAppliedMultiplier, usage)
                    }
                };
                dropped_effects.push(WasmDroppedEffect {
                    alternative_index,
                    effect_index: kept_raw_indices[domain_index],
                    reason,
                    value,
                });
            }
        }

        if !dropped_effects.is_empty() {
            // Target drops accumulate ahead of the core's type/usage drops, so
            // restore submitted order for a consumer reading them positionally.
            dropped_effects
                .sort_by_key(|dropped| (dropped.alternative_index, dropped.effect_index));
            report.push(WasmSkillSupportEntry {
                skill_id: input.skill_id.clone(),
                dropped_effects,
                fully_unmodeled: modeled == 0,
            });
        }
    }
    Ok(report)
}

/// Reject an injected debuff whose skill carries a caster-context value policy
/// (usage 14). The injection harness has no caster, so activated-skill state
/// cannot be resolved; Direct and MultiplyRandom are fine (resolved
/// receiver-locally). This guard is independent of the supported-usage set so it
/// keeps rejecting injected usage 14 even once it becomes a supported policy for
/// normal (cast) skills.
fn reject_caster_context_injection(skill: &WasmSkillInput) -> Result<(), DtoError> {
    use honse_sim::skills::value_scaling::requires_caster_context;
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
    /// CM/LoH team grouping (1-based). Omitted/`null` = no team. Must stay
    /// `Option` so a present-but-`undefined` key deserializes to `None`.
    #[serde(default)]
    pub team: Option<i32>,
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
    /// Scripted downhill-mode regions; any present replaces the per-second roll.
    #[serde(default)]
    pub forced_downhill_regions: Vec<WasmForcedRegion>,
    /// Scripted forced-rank regions.
    #[serde(default)]
    pub forced_rank: Vec<WasmForcedRank>,
    /// Fixed 0-based gate. Omitted/`null` = shuffled with the field. Must stay
    /// `Option` so a present-but-`undefined` key deserializes to `None`.
    #[serde(default)]
    pub gate: Option<i64>,
    /// Scripted start delay in seconds. Omitted/`null` = the engine's draw.
    #[serde(default)]
    pub forced_start_delay: Option<f64>,
    /// Scripted last-spurt transition in meters. Omitted/`null` = the wit roll.
    #[serde(default)]
    pub forced_last_spurt_distance: Option<f64>,
}

impl WasmCreateRunner {
    fn into_domain(self) -> Result<CreateRunner, DtoError> {
        Ok(CreateRunner {
            outfit_id: self.outfit_id,
            name: self.name,
            mood: to_mood(self.mood)?,
            strategy: to_strategy(self.strategy)?,
            popularity: self.popularity,
            team: self.team,
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
            forced_downhill_regions: self
                .forced_downhill_regions
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
            gate: self.gate,
            forced_start_delay: self.forced_start_delay,
            forced_last_spurt_distance: self.forced_last_spurt_distance,
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
    /// Assumed field size the order bands are expressed against. Vacuum runs
    /// hold a single runner, so without this the engine would judge the bands
    /// against a field of one. Absent falls back to the real field.
    #[serde(default)]
    pub num_umas: Option<u32>,
    /// Per-phase assumed order bands `[[lo, hi]; 4]` (vacuum mode only).
    #[serde(default)]
    pub order_ranges: Option<[[u32; 2]; 4]>,
}

impl WasmRaceParameters {
    fn to_domain(&self) -> Result<RaceParameters, DtoError> {
        Ok(RaceParameters {
            ground: to_ground(self.ground)?,
            weather: to_weather(self.weather)?,
            season: to_season(self.season)?,
            time_of_day: to_time_of_day(self.time_of_day)?,
            grade: to_grade(self.grade)?,
            num_umas: self.num_umas,
            order_ranges: self
                .order_ranges
                .map(|bands| bands.map(|[lo, hi]| (lo, hi))),
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
    /// Rushed mechanic default.
    #[serde(default)]
    pub rushed: Option<bool>,
    /// Per-runner rushed settings, by runner insertion index.
    #[serde(default)]
    pub rushed_runners: Option<Vec<bool>>,
    /// Downhill mode default.
    #[serde(default)]
    pub downhill: Option<bool>,
    /// Per-runner downhill settings, by runner insertion index.
    #[serde(default)]
    pub downhill_runners: Option<Vec<bool>>,
    /// Power Conservation / Fully Charged default.
    #[serde(default)]
    pub conserve_power: Option<bool>,
    /// Per-runner Power Conservation settings, by runner insertion index.
    #[serde(default)]
    pub conserve_power_runners: Option<Vec<bool>>,
    /// Spot struggle.
    #[serde(default)]
    pub spot_struggle: Option<bool>,
    /// Dueling.
    #[serde(default)]
    pub dueling: Option<bool>,
    /// Per-runner dueling settings, by runner insertion index.
    #[serde(default)]
    pub dueling_runners: Option<Vec<bool>>,
    /// Wit checks default.
    #[serde(default)]
    pub wit_checks: Option<bool>,
    /// Per-runner wit-check settings, by runner insertion index.
    #[serde(default)]
    pub wit_checks_runners: Option<Vec<bool>>,
    /// Runners that share one RNG stream, by runner insertion index. Absent
    /// leaves every runner on its own stream.
    #[serde(default)]
    pub sync_rng_runners: Option<Vec<bool>>,
    /// Skill sample budget.
    #[serde(default)]
    pub skill_samples: Option<usize>,
    /// Sample each skill's placement from its own seed so adding a skill cannot
    /// re-roll the rest of the build. Compare paths only; absent is off.
    #[serde(default)]
    pub isolate_skill_rng: Option<bool>,
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
    rushed_runners: Vec<bool>,
    downhill: bool,
    downhill_runners: Vec<bool>,
    conserve_power: bool,
    conserve_power_runners: Vec<bool>,
    spot_struggle: bool,
    dueling: bool,
    dueling_runners: Vec<bool>,
    wit_checks: bool,
    wit_checks_runners: Vec<bool>,
    sync_rng_runners: Vec<bool>,
    position_keep_mode: i32,
    skill_samples: usize,
    isolate_skill_rng: bool,
    stamina_drain_overrides: HashMap<String, f64>,
}

impl WasmSettings {
    fn resolve(self) -> ResolvedSettings {
        ResolvedSettings {
            health_system: self.health_system.unwrap_or(true),
            section_modifier: self.section_modifier.unwrap_or(true),
            rushed: self.rushed.unwrap_or(true),
            rushed_runners: self.rushed_runners.unwrap_or_default(),
            downhill: self.downhill.unwrap_or(true),
            downhill_runners: self.downhill_runners.unwrap_or_default(),
            conserve_power: self.conserve_power.unwrap_or(true),
            conserve_power_runners: self.conserve_power_runners.unwrap_or_default(),
            spot_struggle: self.spot_struggle.unwrap_or(true),
            dueling: self.dueling.unwrap_or(true),
            dueling_runners: self.dueling_runners.unwrap_or_default(),
            wit_checks: self.wit_checks.unwrap_or(true),
            wit_checks_runners: self.wit_checks_runners.unwrap_or_default(),
            sync_rng_runners: self.sync_rng_runners.unwrap_or_default(),
            position_keep_mode: self.position_keep_mode.unwrap_or(2),
            skill_samples: self.skill_samples.map_or(1, |v| v.max(1)),
            isolate_skill_rng: self.isolate_skill_rng.unwrap_or(false),
            stamina_drain_overrides: self.stamina_drain_overrides.unwrap_or_default(),
        }
    }

    fn into_race_settings(self) -> RaceSettings {
        let r = self.resolve();
        RaceSettings {
            health_system: r.health_system,
            section_modifier: r.section_modifier,
            rushed: r.rushed,
            rushed_runners: r.rushed_runners,
            downhill: r.downhill,
            downhill_runners: r.downhill_runners,
            conserve_power: r.conserve_power,
            conserve_power_runners: r.conserve_power_runners,
            spot_struggle: r.spot_struggle,
            dueling: r.dueling,
            dueling_runners: r.dueling_runners,
            wit_checks: r.wit_checks,
            wit_checks_runners: r.wit_checks_runners,
            position_keep_mode: r.position_keep_mode,
            skill_samples: r.skill_samples,
            isolate_skill_rng: r.isolate_skill_rng,
            stamina_drain_overrides: r.stamina_drain_overrides,
        }
    }

    fn into_vacuum_settings(self) -> VacuumSettings {
        let r = self.resolve();
        VacuumSettings {
            health_system: r.health_system,
            section_modifier: r.section_modifier,
            rushed: r.rushed,
            rushed_runners: r.rushed_runners,
            downhill: r.downhill,
            downhill_runners: r.downhill_runners,
            conserve_power: r.conserve_power,
            conserve_power_runners: r.conserve_power_runners,
            spot_struggle: r.spot_struggle,
            dueling: r.dueling,
            dueling_runners: r.dueling_runners,
            wit_checks: r.wit_checks,
            wit_checks_runners: r.wit_checks_runners,
            sync_rng_runners: r.sync_rng_runners,
            position_keep_mode: r.position_keep_mode,
            skill_samples: r.skill_samples,
            isolate_skill_rng: r.isolate_skill_rng,
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
    /// The contestants (typically 1 — vacuum race). Compared runners come
    /// first, then context runners such as a pacer.
    pub runners: Vec<WasmCreateRunner>,
    /// How many leading runners to collect. Omit for the vacuum default (1);
    /// a same-race vacuum compare passes 2. `Option` so a present-but-
    /// `undefined` key stays the default.
    #[serde(default)]
    pub focus_count: Option<usize>,
    /// Number of rounds.
    pub nsamples: usize,
    /// Master seed.
    pub master_seed: u64,
    /// Run only these round indices instead of `0..nsamples`.
    ///
    /// Round `i` is seeded `master_seed + i` and pins its own round counter, so
    /// asking for one index reproduces that exact round of the batch. Omit to
    /// run the whole batch; a summary names representative rounds this way
    /// instead of carrying every round across the boundary.
    #[serde(default)]
    pub round_indices: Vec<usize>,
}

impl WasmCompareParams {
    /// The named round indices, or `None` for the whole batch.
    pub fn round_indices(&self) -> Option<&[usize]> {
        if self.round_indices.is_empty() {
            None
        } else {
            Some(self.round_indices.as_slice())
        }
    }

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
            focus_count: self.focus_count.unwrap_or(1),
            nsamples: self.nsamples,
            master_seed: self.master_seed,
        })
    }
}

/// Inputs to a paired vacuum compare: two independently-raced fields.
///
/// The classic vacuum compare races each contestant in its own field and diffs
/// the two position series. A paired-delta summary needs both sides, so they
/// arrive together rather than as two calls whose alignment a caller has to
/// guarantee.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmPairedCompareParams {
    /// The first contestant's field.
    pub first: WasmCompareParams,
    /// The second contestant's field, on the same seed schedule.
    pub second: WasmCompareParams,
}

impl WasmPairedCompareParams {
    /// Convert both sides to domain params, rejecting a sample-count mismatch.
    pub fn into_domain(self) -> Result<(CompareSimParams, CompareSimParams), DtoError> {
        if self.first.nsamples != self.second.nsamples {
            return Err(DtoError(format!(
                "a paired compare needs one sample count, got {} and {}",
                self.first.nsamples, self.second.nsamples
            )));
        }
        if self.first.master_seed != self.second.master_seed {
            return Err(DtoError(format!(
                "a paired compare needs one master seed, got {} and {}",
                self.first.master_seed, self.second.master_seed
            )));
        }

        Ok((self.first.into_domain()?, self.second.into_domain()?))
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
    /// Run only these round indices instead of `0..nsamples`.
    ///
    /// Round `i` is seeded `master_seed + i` and pins its own round counter, so
    /// asking for one index reproduces that exact round of the batch.
    #[serde(default)]
    pub round_indices: Vec<usize>,
}

impl WasmContestedCompareParams {
    /// The named round indices, or `None` for the whole batch.
    pub fn round_indices(&self) -> Option<&[usize]> {
        if self.round_indices.is_empty() {
            None
        } else {
            Some(self.round_indices.as_slice())
        }
    }

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
    /// The field to race (2..=12 runners).
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
            // The batch run only produces finish orders, telemetry, and event
            // logs; a caller that wants a replay asks for one round through
            // [`WasmRaceReplayParams`] instead of paying for every round here.
            include_replays: false,
        })
    }
}

/// Inputs to a single-round replay projection.
///
/// The same field as [`WasmRaceSimParams`] without the batch sampling: one
/// round, named by index, returned as the packed capture bytes.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmRaceReplayParams {
    /// The course.
    pub course: WasmCourseData,
    /// Race parameters.
    pub parameters: WasmRaceParameters,
    /// Optional settings. `Option` because a present-but-`undefined` key
    /// deserializes as a unit value rather than an absent key (see
    /// `honse-sim` AGENTS.md), so a caller that leaves settings out still
    /// converts.
    #[serde(default)]
    pub settings: Option<WasmSettings>,
    /// The field to race (2..=12 runners).
    pub runners: Vec<WasmCreateRunner>,
    /// Master seed of the round (round `i` of a batch run uses `masterSeed + i`).
    pub master_seed: u64,
    /// Absolute index of the round to reproduce.
    pub round_index: usize,
}

impl WasmRaceReplayParams {
    /// Convert to the domain [`RaceReplayParams`].
    pub fn into_domain(self) -> Result<RaceReplayParams, DtoError> {
        let settings = self
            .settings
            .map_or_else(RaceSettings::default, WasmSettings::into_race_settings);
        let parameters = self.parameters.to_domain()?;
        let ground = to_ground(self.parameters.ground)?;
        let course = self.course.into_domain()?;
        let runners = self
            .runners
            .into_iter()
            .map(WasmCreateRunner::into_domain)
            .collect::<Result<Vec<_>, _>>()?;
        Ok(RaceReplayParams {
            course,
            ground,
            parameters,
            settings,
            runners,
            master_seed: self.master_seed,
            round_index: self.round_index,
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

/// The metadata half of a focus runner's per-round trace.
///
/// The per-tick series are attached as `Float32Array`s by [`collected_to_js`].
/// A trace is one of the largest payloads the app holds — every focused runner,
/// every tick, every round, on the main thread — so a column of typed numbers
/// beats one JS object per sample by a wide margin.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FocusTraceMeta {
    /// Runner id.
    runner_id: u32,
    /// Self-cast skill-effect activation logs (`[start, end]` position ranges),
    /// keyed by skill id. Serialized as a JS object (not a Map) via
    /// `serialize_maps_as_objects(true)` in `to_js`.
    skill_activations: HashMap<String, Vec<WasmSkillEffectLog>>,
}

/// The metadata half of one round's collected data.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RoundMeta {
    /// Round seed.
    seed: u64,
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

/// The serialized simulation result, minus the collected telemetry.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RaceSimResultMeta {
    /// Per-round finish orders.
    finish_orders: Vec<Vec<WasmFinishEntry>>,
    /// Per-round logged race events.
    event_logs: Vec<Vec<WasmRaceEvent>>,
}

/// Build the JS value for a race-sim result: serde for the metadata, typed
/// arrays for the per-tick focus telemetry.
pub fn race_sim_result_to_js(
    finish_orders: Vec<Vec<WasmFinishEntry>>,
    collected: &CollectedData,
    event_logs: &RaceEventLog,
) -> Result<JsValue, JsError> {
    let meta = RaceSimResultMeta {
        finish_orders,
        event_logs: event_logs_to_wasm(event_logs),
    };
    let object = to_js(&meta)?;
    let collected = collected_to_js(collected)?;
    js_sys::Reflect::set(&object, &JsValue::from_str("collected"), collected.as_ref())
        .map_err(|err| JsError::new(&format!("failed to set collected: {err:?}")))?;
    Ok(object)
}

/// Build the output JS value from a domain [`RaceSimResult`].
pub fn race_sim_result_from_domain(result: &RaceSimResult) -> Result<JsValue, JsError> {
    race_sim_result_to_js(
        result
            .finish_orders
            .iter()
            .map(|order| order.iter().map(WasmFinishEntry::from).collect())
            .collect(),
        &result.collected,
        &result.event_logs,
    )
}

/// Build the `collected` array: one round object per round, one trace object per
/// focused runner, each carrying its per-tick series as typed arrays.
fn collected_to_js(data: &CollectedData) -> Result<js_sys::Array, JsError> {
    let rounds = js_sys::Array::new();
    for round in &data.rounds {
        let focus = js_sys::Array::new();
        for trace in &round.focus {
            let mut time: Vec<f64> = Vec::with_capacity(trace.samples.len());
            let mut position: Vec<f64> = Vec::with_capacity(trace.samples.len());
            let mut speed: Vec<f64> = Vec::with_capacity(trace.samples.len());
            let mut lane: Vec<f64> = Vec::with_capacity(trace.samples.len());
            let mut health: Vec<f64> = Vec::with_capacity(trace.samples.len());
            for sample in &trace.samples {
                time.push(sample.time);
                position.push(sample.position);
                speed.push(sample.speed);
                lane.push(sample.lane);
                health.push(sample.health);
            }

            let meta = FocusTraceMeta {
                runner_id: trace.runner_id.0,
                skill_activations: skill_activation_map_to_wasm(&trace.skill_activations),
            };
            let object = to_js(&meta)?;
            set_f32_series(&object, "time", &time)?;
            set_f32_series(&object, "position", &position)?;
            set_f32_series(&object, "speed", &speed)?;
            set_f32_series(&object, "lane", &lane)?;
            set_f32_series(&object, "health", &health)?;
            focus.push(&object);
        }

        let round_object = to_js(&RoundMeta { seed: round.seed })?;
        js_sys::Reflect::set(&round_object, &JsValue::from_str("focus"), focus.as_ref())
            .map_err(|err| JsError::new(&format!("failed to set focus: {err:?}")))?;
        rounds.push(&round_object);
    }
    Ok(rounds)
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

/// Where a runner's HP went, crossing back to JS.
///
/// Every cause amount is a **counterfactual**: the HP the race actually cost
/// minus what it would have cost with that cause gone — both the consumption
/// multiplier it applied and the speed it supplied, since drain is quadratic in
/// speed. Negative is a saving. The causes do not sum to
/// `totalSpent - baselineSpent`; overlapping mechanics are each priced against
/// a baseline where the other still applies.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmStaminaLedger {
    /// HP the runner would have spent with no status mechanic active.
    pub baseline_spent: f64,
    /// HP actually drained.
    pub total_spent: f64,
    /// Amount attributed to downhill mode (negative: a saving).
    pub downhill: f64,
    /// Amount attributed to being rushed.
    pub rushed: f64,
    /// Amount attributed to spot-struggle.
    pub spot_struggle: f64,
    /// Amount attributed to pace-down (negative: a saving).
    pub pace_down: f64,
    /// Amount attributed to speed-raising position keeping. No consumption
    /// multiplier is involved; the cost is purely the extra speed.
    pub pace_up: f64,
    /// Amount attributed to dueling, likewise entirely through speed.
    pub dueling: f64,
    /// HP restored by recovery effects, as the clamped delta.
    pub total_recovered: f64,
    /// HP removed by negative-modifier effects (HP-drain debuffs).
    pub total_drained_by_effects: f64,
    /// Number of recovery effects that actually restored HP.
    pub recovery_procs: u32,
    /// Max HP for this run.
    pub max_hp: f64,
    /// HP left over when the last-spurt decision was made, after the spurt's
    /// own cost. Negative is the deficit to a full spurt. Absent when the
    /// policy never reached the decision.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spurt_margin: Option<f64>,
    /// HP that decision charged for the remainder of the race: the bill the
    /// margin above was measured against, at the status the runner was in when
    /// it crossed the line. Absent when the policy never reached the decision.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spurt_hp_required: Option<f64>,
}

impl From<&StaminaLedger> for WasmStaminaLedger {
    fn from(l: &StaminaLedger) -> Self {
        WasmStaminaLedger {
            baseline_spent: l.baseline_spent,
            total_spent: l.total_spent,
            downhill: l.downhill,
            rushed: l.rushed,
            spot_struggle: l.spot_struggle,
            pace_down: l.pace_down,
            pace_up: l.pace_up,
            dueling: l.dueling,
            total_recovered: l.total_recovered,
            total_drained_by_effects: l.total_drained_by_effects,
            recovery_procs: l.recovery_procs,
            max_hp: l.max_hp,
            spurt_margin: l.spurt_margin,
            spurt_hp_required: l.spurt_hp_required,
        }
    }
}

/// One position-keep region, in metres and the engine's state discriminant.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmPositionKeepRegion {
    /// Position the state began, in metres.
    pub start: f64,
    /// Position the state ended, in metres.
    pub end: f64,
    /// `PositionKeepState` discriminant: 1 pace up, 2 pace down, 3 speed up,
    /// 4 overtake, 5 pace up ex. 0 (no state) is never emitted as a region.
    pub state: i32,
}

/// The metadata half of a rich per-runner, per-round compare payload.
///
/// The per-tick series are attached as typed arrays by [`compare_data_to_js`],
/// not serialized field by field: a compare round is almost entirely numbers, so
/// a `Float32Array` crosses the boundary in one bulk copy instead of one
/// `Array::push` per sample, and lives off the JS heap instead of in it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareRunnerMeta {
    /// Runner id.
    pub runner_id: u32,
    /// Self-cast skill-effect activation logs, keyed by skill id.
    pub skill_activations: HashMap<String, Vec<WasmSkillEffectLog>>,
    /// Externally-targeted skill-effect activation logs, keyed by skill id.
    pub targeted_skill_activations: HashMap<String, Vec<WasmSkillEffectLog>>,
    /// Start delay in seconds.
    pub start_delay: f64,
    /// Closed rushed regions as `[start, end]` pairs.
    pub rushed: Vec<[f64; 2]>,
    /// Position-keep regions, in activation order. Empty on engine builds that
    /// predate this channel, which reads as "not recorded", not as "none".
    pub position_keep_regions: Vec<WasmPositionKeepRegion>,
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
    /// Where this runner's HP went. Absent on engines without the ledger, which
    /// consumers must report as unavailable rather than as zeros.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stamina_ledger: Option<WasmStaminaLedger>,
    /// Ids of skills used this round (in activation order).
    pub used_skills: Vec<String>,
    /// Whether the runner finished.
    pub finished: bool,
    /// Final position.
    pub finish_position: f64,
}

impl From<&CompareRoundData> for CompareRunnerMeta {
    fn from(d: &CompareRoundData) -> Self {
        CompareRunnerMeta {
            runner_id: d.runner_id,
            skill_activations: skill_activation_map_to_wasm(&d.skill_activations),
            targeted_skill_activations: skill_activation_map_to_wasm(&d.targeted_skill_activations),
            start_delay: d.start_delay,
            rushed: d.rushed.iter().map(|&(s, e)| [s, e]).collect(),
            position_keep_regions: d
                .position_keep_regions
                .iter()
                .map(|&(start, end, state)| WasmPositionKeepRegion {
                    start,
                    end,
                    state: state as i32,
                })
                .collect(),
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
            stamina_ledger: d.stamina_ledger.as_ref().map(WasmStaminaLedger::from),
            used_skills: d.used_skills.clone(),
            finished: d.finished,
            finish_position: d.finish_position,
        }
    }
}

/// The metadata half of one round's compare payload.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CompareRoundMeta {
    /// Master seed.
    seed: u64,
    /// The primary (first-added) runner's id, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    primary_runner_id: Option<u32>,
}

/// Set `key` on `object` to a `Float32Array` copy of `values`.
///
/// The engine computes in `f64`; this read model is the one place that narrows
/// to `f32`. Measured over 100 compare rounds the largest quantisation error is
/// 6.1e-5 m on position, 9.5e-7 m/s on velocity, and 1.8e-6 s on time — orders of
/// magnitude below what a bashin delta resolves — and it halves the bytes the
/// worker holds while moving them off the JS heap.
fn set_f32_series(object: &JsValue, key: &str, values: &[f64]) -> Result<(), JsError> {
    let narrow: Vec<f32> = values.iter().map(|&value| value as f32).collect();
    let array = js_sys::Float32Array::from(narrow.as_slice());
    js_sys::Reflect::set(object, &JsValue::from_str(key), &array)
        .map(|_| ())
        .map_err(|err| JsError::new(&format!("failed to set compare series {key}: {err:?}")))
}

/// Set `key` on `object` to an `Int32Array` copy of `values`.
fn set_i32_series(object: &JsValue, key: &str, values: &[i64]) -> Result<(), JsError> {
    let narrow: Vec<i32> = values.iter().map(|&value| value as i32).collect();
    let array = js_sys::Int32Array::from(narrow.as_slice());
    js_sys::Reflect::set(object, &JsValue::from_str(key), &array)
        .map(|_| ())
        .map_err(|err| JsError::new(&format!("failed to set compare series {key}: {err:?}")))
}

/// One `{ seed, primaryRunnerId?, runners }` round object.
fn compare_round_object(
    seed: u64,
    primary_runner_id: Option<u32>,
    runners: &js_sys::Array,
) -> Result<JsValue, JsError> {
    let round_object = to_js(&CompareRoundMeta {
        seed,
        primary_runner_id,
    })?;
    js_sys::Reflect::set(
        &round_object,
        &JsValue::from_str("runners"),
        runners.as_ref(),
    )
    .map_err(|err| JsError::new(&format!("failed to set compare runners: {err:?}")))?;
    Ok(round_object)
}

/// The `{ rounds }` result object every compare endpoint returns.
fn rounds_to_js(rounds: &js_sys::Array) -> Result<JsValue, JsError> {
    let result = js_sys::Object::new();
    js_sys::Reflect::set(&result, &JsValue::from_str("rounds"), rounds.as_ref())
        .map_err(|err| JsError::new(&format!("failed to set compare rounds: {err:?}")))?;
    Ok(result.into())
}

/// Attach the per-tick series to a runner's metadata object.
fn attach_compare_series(object: &JsValue, runner: &CompareRoundData) -> Result<(), JsError> {
    set_f32_series(object, "time", &runner.time)?;
    set_f32_series(object, "position", &runner.position)?;
    set_f32_series(object, "velocity", &runner.velocity)?;
    set_f32_series(object, "hp", &runner.hp)?;
    set_f32_series(object, "currentLane", &runner.current_lane)?;
    set_f32_series(object, "pacerGap", &runner.pacer_gap)?;
    set_i32_series(object, "order", &runner.order)
}

/// Build the JS value for a rich compare result: serde for the metadata, typed
/// arrays for the per-tick series.
///
/// Replaces the `Serialize` derive on the result: `serde_wasm_bindgen` can only
/// build plain JS arrays, which is the payload shape this exists to avoid.
pub fn compare_data_to_js(data: &CompareData) -> Result<JsValue, JsError> {
    let rounds = js_sys::Array::new();
    for round in &data.rounds {
        let runners = js_sys::Array::new();
        for runner in &round.runners {
            let object = to_js(&CompareRunnerMeta::from(runner))?;
            attach_compare_series(&object, runner)?;
            runners.push(&object);
        }

        rounds.push(&compare_round_object(
            round.seed,
            round.primary_runner_id,
            &runners,
        )?);
    }
    rounds_to_js(&rounds)
}

/// The metadata half of a position-only per-runner round payload.
///
/// The skill planner's bashin delta reads only positions, so this lean read
/// model omits the velocity/HP/lane/order/effect channels the rich compare
/// payload carries. Frames match `CompareRoundData.position` exactly.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PositionRunnerMeta {
    /// Runner id.
    runner_id: u32,
}

/// Build the JS value for a position-only compare result.
pub fn position_data_to_js(data: &PositionData) -> Result<JsValue, JsError> {
    let rounds = js_sys::Array::new();
    for round in &data.rounds {
        let runners = js_sys::Array::new();
        for runner in &round.runners {
            let object = to_js(&PositionRunnerMeta {
                runner_id: runner.runner_id,
            })?;
            set_f32_series(&object, "position", &runner.position)?;
            runners.push(&object);
        }
        rounds.push(&compare_round_object(
            round.seed,
            round.primary_runner_id,
            &runners,
        )?);
    }
    rounds_to_js(&rounds)
}

/// The metadata half of a lean per-runner, per-round basin payload.
///
/// The basin reduction reads the time/position/velocity series, the tracked
/// skill's self-cast activation logs, whether each skill was used, and the
/// finish position. The HP/lane/pacer/order channels, targeted activations, and
/// mechanic regions the full compare read-model carries are left out.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BasinRunnerMeta {
    /// Runner id.
    runner_id: u32,
    /// Self-cast skill-effect activation logs, keyed by skill id.
    skill_activations: HashMap<String, Vec<WasmSkillEffectLog>>,
    /// Ids of skills used this round (in activation order).
    used_skills: Vec<String>,
    /// Final position.
    finish_position: f64,
}

/// Build the JS value for a basin compare result.
pub fn basin_data_to_js(data: &BasinData) -> Result<JsValue, JsError> {
    let rounds = js_sys::Array::new();
    for round in &data.rounds {
        let runners = js_sys::Array::new();
        for runner in &round.runners {
            let object = to_js(&BasinRunnerMeta {
                runner_id: runner.runner_id,
                skill_activations: skill_activation_map_to_wasm(&runner.skill_activations),
                used_skills: runner.used_skills.clone(),
                finish_position: runner.finish_position,
            })?;
            set_f32_series(&object, "time", &runner.time)?;
            set_f32_series(&object, "position", &runner.position)?;
            set_f32_series(&object, "velocity", &runner.velocity)?;
            runners.push(&object);
        }
        rounds.push(&compare_round_object(
            round.seed,
            round.primary_runner_id,
            &runners,
        )?);
    }
    rounds_to_js(&rounds)
}

/// One candidate in a dedicated ranking run.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmRankCandidate {
    /// The skill appended to the baseline for this candidate's race.
    pub skill: WasmSkillInput,
    /// Baseline skill ids the candidate replaces (its family's lower tiers).
    #[serde(default)]
    pub supersedes: Vec<String>,
}

/// Inputs to a dedicated skill-ranking run.
///
/// Unlike [`WasmCompareParams`], the baseline runner and the candidate skills
/// are passed separately: the engine appends each candidate to the baseline and
/// computes the bashin delta internally, so no per-sample telemetry crosses back.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmSkillRankParams {
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
    /// The baseline runner (its own skills included).
    pub runner: WasmCreateRunner,
    /// Skills to append to the baseline, one candidate per entry.
    pub candidates: Vec<WasmRankCandidate>,
    /// Number of rounds per runner.
    pub nsamples: usize,
    /// Master seed.
    pub master_seed: u64,
    /// Start of the measured stretch, in metres.
    pub window_start: f64,
    /// End of the measured stretch, in metres.
    pub window_end: f64,
}

impl WasmSkillRankParams {
    /// Convert to the domain [`SkillRankParams`].
    pub fn into_domain(self) -> Result<SkillRankParams, DtoError> {
        let settings = self.settings.into_vacuum_settings();
        let parameters = self.parameters.to_domain()?;
        let ground = to_ground(self.parameters.ground)?;
        let course = self.course.into_domain()?;
        let runner = self.runner.into_domain()?;
        let candidates = self
            .candidates
            .into_iter()
            .map(|candidate| {
                Ok(RankCandidate {
                    skill: candidate.skill.into_domain()?,
                    supersedes: candidate.supersedes,
                })
            })
            .collect::<Result<Vec<_>, DtoError>>()?;
        let dueling_rates = match self.dueling_rates {
            Some(rates) => rates.into(),
            None => DuelingRates {
                runaway: 10.0,
                front_runner: 10.0,
                pace_chaser: 10.0,
                late_surger: 10.0,
                end_closer: 10.0,
            },
        };
        Ok(SkillRankParams {
            course,
            ground,
            parameters,
            settings,
            dueling_rates,
            runner,
            candidates,
            nsamples: self.nsamples,
            master_seed: self.master_seed,
            window_start: self.window_start,
            window_end: self.window_end,
        })
    }
}

/// One candidate's measured marginal, crossing back to JS.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmSkillRankEntry {
    /// The candidate skill id.
    pub skill_id: String,
    /// Mean bashin gained over the baseline.
    pub mean: f64,
    /// Minimum per-sample bashin.
    pub min: f64,
    /// Maximum per-sample bashin.
    pub max: f64,
    /// Median per-sample bashin.
    pub median: f64,
    /// Per-sample bashin deltas, ascending.
    pub results: Vec<f64>,
}

/// The serialized ranking result (one entry per candidate).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmSkillRankData {
    /// Per-candidate results.
    pub entries: Vec<WasmSkillRankEntry>,
}

impl WasmSkillRankData {
    /// Build the output DTO from a domain [`SkillRankData`].
    pub fn from_domain(data: &SkillRankData) -> Self {
        WasmSkillRankData {
            entries: data
                .entries
                .iter()
                .map(|entry| WasmSkillRankEntry {
                    skill_id: entry.skill_id.clone(),
                    mean: entry.mean,
                    min: entry.min,
                    max: entry.max,
                    median: entry.median,
                    results: entry.results.clone(),
                })
                .collect(),
        }
    }
}

// --------- pre-race stamina budget ---------

impl WasmStatLine {
    /// Reject a stat the engine cannot price.
    ///
    /// The floor is 1, not 0: guts divides into the late-race burn multiplier,
    /// so zero guts makes the spurt bill infinite and the whole budget
    /// non-numeric. Validating here keeps `inf` off the JS boundary.
    fn validate(&self) -> Result<(), DtoError> {
        for (name, value) in [
            ("speed", self.speed),
            ("stamina", self.stamina),
            ("power", self.power),
            ("guts", self.guts),
            ("wit", self.wit),
        ] {
            if value < 1 {
                return Err(DtoError(format!("{name} must be at least 1, got {value}")));
            }
        }
        Ok(())
    }
}

/// Input for the pre-race stamina budget readout.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmStaminaBudgetParams {
    /// Course distance in meters.
    pub distance: f64,
    /// Track surface (1 turf, 2 dirt).
    pub surface: i32,
    /// Ground condition (1 firm, 2 good, 3 soft, 4 heavy).
    pub ground: i32,
    /// Running style (1..5).
    pub strategy: i32,
    /// Motivation (-2 awful .. 2 great).
    pub mood: i32,
    /// Raw input stats, before overcap and mood adjustment.
    pub stats: WasmStatLine,
    /// Distance aptitude (0 S .. 7 G).
    pub distance_aptitude: i32,
    /// Strategy aptitude (0 S .. 7 G).
    pub strategy_aptitude: i32,
    /// The course's threshold stats (1..5), as `courseSetStatus`. Omitted or
    /// empty means no adjusted-speed bonus.
    ///
    /// `Option` because a present-but-`undefined` key is a unit value to serde,
    /// not an absent one; a bare `Vec` rejects it.
    #[serde(default)]
    pub course_set_status: Option<Vec<i32>>,
    /// Recovery the build brings, in raw (×10000) units of max HP — the value a
    /// Recovery skill effect carries, summed across the skills. Omitted means
    /// none.
    #[serde(default)]
    pub heal_basis_points: Option<f64>,
    /// HP-consumption multiplier for the conditions being assumed: omit for a
    /// clean run. The engine derives the real one per tick from rushed, spot
    /// struggle, downhill, and pace-down state.
    #[serde(default)]
    pub status_modifier: Option<f64>,
}

impl WasmStaminaBudgetParams {
    pub fn into_domain(self) -> Result<StaminaBudgetInput, DtoError> {
        if !self.distance.is_finite() || self.distance <= 0.0 {
            return Err(DtoError(format!(
                "distance must be a positive number, got {}",
                self.distance
            )));
        }

        // Absent and present-but-`undefined` both land here as `None`: none is
        // recovery, and none is a clean run. A multiplier the caller did send
        // still has to be a real one.
        let heal_basis_points = self.heal_basis_points.unwrap_or(0.0);
        if !heal_basis_points.is_finite() {
            return Err(DtoError(
                "healBasisPoints must be a finite number".to_string(),
            ));
        }

        let status_modifier = self.status_modifier.unwrap_or(1.0);
        if !status_modifier.is_finite() || status_modifier < 0.0 {
            return Err(DtoError(format!(
                "statusModifier must be a non-negative number, got {status_modifier}"
            )));
        }

        self.stats.validate()?;

        Ok(StaminaBudgetInput {
            distance: self.distance,
            surface: to_surface(self.surface)?,
            ground: to_ground(self.ground)?,
            strategy: to_strategy(self.strategy)?,
            mood: to_mood(self.mood)?,
            stats: self.stats.into(),
            distance_aptitude: to_aptitude(self.distance_aptitude)?,
            strategy_aptitude: to_aptitude(self.strategy_aptitude)?,
            course_set_status: self
                .course_set_status
                .unwrap_or_default()
                .into_iter()
                .map(to_threshold_stat)
                .collect::<Result<Vec<_>, _>>()?,
            heal_basis_points,
            status_modifier,
        })
    }
}

/// What a build's HP covers on one course, before a race runs.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmStaminaBudget {
    /// HP the runner starts with.
    pub max_hp: f64,
    /// Stamina's conversion coefficient for the strategy.
    pub strategy_coefficient: f64,
    /// Late-race HP burn multiplier from guts.
    pub guts_hp_burn_multiplier: f64,
    /// Course base speed.
    pub base_speed: f64,
    /// Surface × ground-condition HP consumption coefficient.
    pub ground_consumption_coefficient: f64,
    /// Last-spurt target speed.
    pub spurt_speed: f64,
    /// Ground the spurt window covers, in meters.
    pub spurt_distance: f64,
    /// HP burned per second at spurt speed.
    pub spurt_hp_per_second: f64,
    /// HP the last third costs at spurt speed.
    pub spurt_hp_required: f64,
    /// HP the entered recoveries restore, capped at one bar.
    pub heal_hp: f64,
    /// Estimated HP the race costs before the late-race line.
    pub early_mid_hp: f64,
    /// Estimated HP left when the spurt decision is made.
    pub hp_at_late_race: f64,
    /// `hpAtLateRace + healHp - spurtHpRequired`; negative means short.
    pub hp_margin: f64,
    /// What the recoveries are worth in stamina points at the current bar.
    pub stamina_equivalent_healed: f64,
    /// Adjusted stamina the budget was priced with.
    pub adjusted_stamina: f64,
    /// Adjusted guts the budget was priced with.
    pub adjusted_guts: f64,
    /// Adjusted speed the budget was priced with.
    pub adjusted_speed: f64,
    /// Lowest adjusted stamina that clears the spurt window, recoveries
    /// included.
    pub stamina_requirement: f64,
    /// Whether the budget covers a full spurt.
    pub reaches_full_spurt: bool,
}

impl From<StaminaBudget> for WasmStaminaBudget {
    fn from(b: StaminaBudget) -> Self {
        WasmStaminaBudget {
            max_hp: b.max_hp,
            strategy_coefficient: b.strategy_coefficient,
            guts_hp_burn_multiplier: b.guts_hp_burn_multiplier,
            base_speed: b.base_speed,
            ground_consumption_coefficient: b.ground_consumption_coefficient,
            spurt_speed: b.spurt_speed,
            spurt_distance: b.spurt_distance,
            spurt_hp_per_second: b.spurt_hp_per_second,
            spurt_hp_required: b.spurt_hp_required,
            heal_hp: b.heal_hp,
            early_mid_hp: b.early_mid_hp,
            hp_at_late_race: b.hp_at_late_race,
            hp_margin: b.hp_margin,
            stamina_equivalent_healed: b.stamina_equivalent_healed,
            adjusted_stamina: b.adjusted_stamina,
            adjusted_guts: b.adjusted_guts,
            adjusted_speed: b.adjusted_speed,
            stamina_requirement: b.stamina_requirement,
            reaches_full_spurt: b.reaches_full_spurt,
        }
    }
}

/// A tracked-skill comparison's inputs, as the skill/unique basin posts them.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmSkillCompareParams {
    /// The tracked runner's field (baseline runner plus the tracked skill).
    pub params: WasmCompareParams,
    /// The skill the comparison is about.
    pub tracked_skill_id: String,
    /// Effect type the synthetic activation log carries when the round recorded
    /// none. Omit for 0, which draws as an unknown effect rather than failing.
    #[serde(default)]
    pub fallback_effect_type: i32,
    /// Effect target for the same fallback log.
    #[serde(default)]
    pub fallback_effect_target: i32,
    /// The stretch of the race to score.
    pub window: WasmEvaluationWindow,
    /// Materialise only these round indices instead of the whole batch.
    ///
    /// `summarize` ignores it; `payloads` uses it to rebuild the representative
    /// races a summary named, seeded `masterSeed + i` and pinned to their own
    /// round counter.
    #[serde(default)]
    pub round_indices: Vec<usize>,
}

impl WasmSkillCompareParams {
    /// The fallback effect a synthetic log carries.
    pub fn fallback(&self) -> FallbackEffect {
        FallbackEffect {
            effect_type: self.fallback_effect_type,
            effect_target: self.fallback_effect_target,
        }
    }

    /// The stretch of the race to score, in the domain's terms.
    pub fn window(&self) -> EvaluationWindow {
        EvaluationWindow {
            start_distance: self.window.start_distance,
            end_distance: self.window.end_distance,
        }
    }
}

/// The stretch of the race a skill comparison scores, in metres.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmEvaluationWindow {
    /// Start of the measured stretch.
    pub start_distance: f64,
    /// End of the measured stretch.
    pub end_distance: f64,
}

/// The named rounds a summary's representative races live in.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmRoundIndices {
    /// Absolute round indices to run, in the order the caller wants them back.
    #[serde(default)]
    pub round_indices: Vec<usize>,
}

/// One runner's per-tick series, as the lean read models carry it.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmBasinRunnerSeries {
    /// Runner id (unused by the reduction, kept so the shape matches the read model).
    #[serde(default)]
    pub runner_id: u32,
    /// Per-tick elapsed time.
    #[serde(default)]
    pub time: Vec<f64>,
    /// Per-tick position.
    #[serde(default)]
    pub position: Vec<f64>,
    /// Per-tick true velocity.
    #[serde(default)]
    pub velocity: Vec<f64>,
}

/// One round of the basin read model, restricted to the baseline's channels.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmBasinRoundDto {
    /// Master seed.
    #[serde(default)]
    pub seed: u64,
    /// The primary (first-seen) runner's id, if any.
    #[serde(default)]
    pub primary_runner_id: Option<u32>,
    /// Per-runner series.
    #[serde(default)]
    pub runners: Vec<WasmBasinRunnerSeries>,
}

/// The basin read model a skill comparison reuses as its baseline.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmBasinBaseline {
    /// Per-round series.
    #[serde(default)]
    pub rounds: Vec<WasmBasinRoundDto>,
}

impl WasmBasinBaseline {
    /// Convert to the domain rounds the reduction reads.
    ///
    /// Only the primary runner of each round survives: the reduction pairs one
    /// runner per side, and the rest of the field is not the comparison.
    pub fn into_domain(self) -> Vec<BasinRound> {
        self.rounds
            .into_iter()
            .map(|round| {
                let primary = primary_index(round.primary_runner_id, &round.runners);
                let taken: Vec<BasinRoundData> = primary
                    .and_then(|index| round.runners.into_iter().nth(index))
                    .map(|runner| {
                        vec![BasinRoundData {
                            runner_id: runner.runner_id,
                            time: runner.time,
                            position: runner.position,
                            velocity: runner.velocity,
                            ..BasinRoundData::default()
                        }]
                    })
                    .unwrap_or_default();
                BasinRound {
                    seed: round.seed,
                    primary_runner_id: primary.map(|_| 0),
                    runners: taken,
                }
            })
            .collect()
    }
}

/// One round of the position-only read model.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmPositionRoundDto {
    /// Master seed.
    #[serde(default)]
    pub seed: u64,
    /// The primary (first-seen) runner's id, if any.
    #[serde(default)]
    pub primary_runner_id: Option<u32>,
    /// Per-runner positions.
    #[serde(default)]
    pub runners: Vec<WasmPositionRunnerDto>,
}

/// One runner's position series.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmPositionRunnerDto {
    /// Runner id.
    #[serde(default)]
    pub runner_id: u32,
    /// Per-tick position.
    #[serde(default)]
    pub position: Vec<f64>,
}

/// The position-only read model the planner reuses as its baseline.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmPositionBaseline {
    /// Per-round positions.
    #[serde(default)]
    pub rounds: Vec<WasmPositionRoundDto>,
}

impl WasmPositionBaseline {
    /// Convert to the domain rounds the reduction reads.
    pub fn into_domain(self) -> Vec<PositionRound> {
        self.rounds
            .into_iter()
            .map(|round| {
                let primary = primary_index(round.primary_runner_id, &round.runners);
                let taken: Vec<PositionRoundData> = primary
                    .and_then(|index| round.runners.into_iter().nth(index))
                    .map(|runner| {
                        vec![PositionRoundData {
                            runner_id: runner.runner_id,
                            position: runner.position,
                        }]
                    })
                    .unwrap_or_default();
                PositionRound {
                    seed: round.seed,
                    primary_runner_id: primary.map(|_| 0),
                    runners: taken,
                }
            })
            .collect()
    }
}

/// The index of the round's primary runner, falling back to the first one.
fn primary_index<T: HasRunnerId>(primary_runner_id: Option<u32>, runners: &[T]) -> Option<usize> {
    if runners.is_empty() {
        return None;
    }

    match primary_runner_id {
        Some(id) => Some(
            runners
                .iter()
                .position(|runner| runner.runner_id() == id)
                .unwrap_or(0),
        ),
        None => Some(0),
    }
}

/// The id a runner DTO carries, resolved by the generic primary lookup.
trait HasRunnerId {
    fn runner_id(&self) -> u32;
}

impl HasRunnerId for WasmBasinRunnerSeries {
    fn runner_id(&self) -> u32 {
        self.runner_id
    }
}

impl HasRunnerId for WasmPositionRunnerDto {
    fn runner_id(&self) -> u32 {
        self.runner_id
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use honse_sim::skills::model::build_skill_effects;

    #[test]
    fn race_parameters_carry_per_phase_order_bands_across_the_js_boundary() {
        let with_bands: WasmRaceParameters = serde_json::from_str(
            r#"{
                "ground": 1,
                "weather": 1,
                "season": 1,
                "timeOfDay": 1,
                "grade": 100,
                "orderRanges": [[1, 1], [1, 1], [3, 4], [1, 1]]
            }"#,
        )
        .expect("parse");

        assert_eq!(
            with_bands.to_domain().expect("domain").order_ranges,
            Some([(1, 1), (1, 1), (3, 4), (1, 1)])
        );
    }

    #[test]
    fn race_parameters_treat_an_absent_or_undefined_order_range_as_unconstrained() {
        let absent: WasmRaceParameters = serde_json::from_str(
            r#"{"ground": 1, "weather": 1, "season": 1, "timeOfDay": 1, "grade": 100}"#,
        )
        .expect("parse");
        assert_eq!(absent.to_domain().expect("domain").order_ranges, None);

        // `present-but-undefined` keys arrive as null across the JS boundary.
        let undefined: WasmRaceParameters = serde_json::from_str(
            r#"{"ground": 1, "weather": 1, "season": 1, "timeOfDay": 1, "grade": 100, "orderRanges": null}"#,
        )
        .expect("parse");
        assert_eq!(undefined.to_domain().expect("domain").order_ranges, None);
    }

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
    fn wasm_skill_input_carries_activate_lot() {
        let lot_gated: WasmSkillInput = serde_json::from_str(
            r#"{
                "skillId": "200491",
                "rarity": 2,
                "activateLot": 1,
                "alternatives": []
            }"#,
        )
        .expect("activate-lot skill input deserializes");
        assert_eq!(
            lot_gated
                .into_domain()
                .expect("activate-lot skill input converts")
                .activate_lot,
            Some(1)
        );

        // Absent key is the "master data does not describe this skill" case, so
        // the engine falls back to its effect-type heuristic rather than guessing.
        let unknown: WasmSkillInput = serde_json::from_str(
            r#"{
                "skillId": "200491",
                "rarity": 2,
                "alternatives": []
            }"#,
        )
        .expect("activate-lot-less skill input deserializes");
        assert_eq!(
            unknown
                .into_domain()
                .expect("activate-lot-less skill input converts")
                .activate_lot,
            None
        );
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
        let effects = build_skill_effects(&skill.alternatives[0], 1);
        assert_eq!(effects.len(), 1, "the unmodeled vision effect is skipped");
        assert_eq!(
            effects[0].effect_type,
            honse_sim::skills::effect::SkillType::WisdomUp
        );
        assert_eq!(effects[0].modifier, 40.0);
    }

    #[test]
    fn radiant_star_is_fully_modeled_once_climax_usage_maps() {
        // Radiant Star (210061): all three effects carry usage 10, so the skill
        // converted but was completely inert. The extract stores raw × 1.2 (the
        // 25+ training-races-won tier), so each effect resolves to its stored
        // modifier and nothing is dropped.
        let dto: WasmSkillInput = serde_json::from_str(
            r#"{
                "skillId": "210061",
                "rarity": 3,
                "alternatives": [{
                    "baseDuration": 50000,
                    "condition": "phase>=2",
                    "effects": [
                        { "modifier": 3000, "target": 1, "type": 27, "valueUsage": 10, "preAppliedMultiplier": 1.2 },
                        { "modifier": 3600, "target": 1, "type": 31, "valueUsage": 10, "preAppliedMultiplier": 1.2 },
                        { "modifier": 420, "target": 1, "type": 27, "valueUsage": 10, "preAppliedMultiplier": 1.2 }
                    ]
                }]
            }"#,
        )
        .expect("skill input deserializes");

        let report = build_skill_support_report(std::slice::from_ref(&dto))
            .expect("report builds for 210061");
        assert!(report.is_empty(), "210061 is fully modeled: {report:?}");

        let skill = dto.into_domain().expect("210061 converts");
        let effects = build_skill_effects(&skill.alternatives[0], 1);
        assert_eq!(effects.len(), 3, "no climax effect is dropped");
        for effect in &effects {
            assert_eq!(effect.value_scaling, ValueScalingPolicy::PreAppliedTier);
        }
        // Stored modifiers pass through untouched — multiplying by the tier again
        // here would double-count what the extract already applied.
        assert_eq!(effects[0].modifier, 0.3);
        assert_eq!(effects[1].modifier, 0.36);
        assert_eq!(effects[2].modifier, 0.042);
    }

    #[test]
    fn skill_input_drops_unsupported_value_usage_effect_and_keeps_the_skill() {
        // Usage 19 has no tier table we can cite, so it stays unmodeled. It must
        // cost only its own effect: rejecting the skill took
        // the whole payload down with it, and an r5 unique is force-included in
        // its runner's set, so a runner whose unique carried one could never be
        // simulated at all.
        let dto: WasmSkillInput = serde_json::from_str(
            r#"{
                "skillId": "210081",
                "rarity": 3,
                "alternatives": [{
                    "baseDuration": 50000,
                    "condition": "phase>=2",
                    "effects": [
                        { "modifier": 2500, "target": 1, "type": 27, "valueUsage": 1 },
                        { "modifier": 500, "target": 1, "type": 27, "valueUsage": 19 }
                    ]
                }]
            }"#,
        )
        .expect("skill input deserializes");

        let skill = dto.into_domain().expect("210081 converts despite usage 19");
        let effects = build_skill_effects(&skill.alternatives[0], 1);
        assert_eq!(effects.len(), 1, "only the usage-19 effect is dropped");
        // The kept effect is the base 0.25, never the unmodeled component folded
        // in: coercing an unmapped usage to Direct would invent a tier we cannot
        // cite, which is worse than omitting the effect.
        assert_eq!(effects[0].modifier, 0.25);
        assert_eq!(effects[0].value_scaling, ValueScalingPolicy::Direct);
    }

    #[test]
    fn tiered_usage_is_modeled_only_when_it_states_the_tier_it_carries() {
        // Forger of Legends (210351) carries usage 12 but is not a scenario skill,
        // so its modifier ships raw while other usage-12 effects ship pre-scaled.
        // Pre-application is gated per skill upstream, so the engine cannot infer
        // it from the usage: without the multiplier the effect must drop, or the
        // simulation understates it by 1.2x with nothing to notice.
        let raw: WasmSkillInput = serde_json::from_str(
            r#"{
                "skillId": "210351",
                "rarity": 3,
                "alternatives": [{
                    "baseDuration": 30000,
                    "condition": "phase>=2",
                    "effects": [
                        { "modifier": 500, "target": 1, "type": 27, "valueUsage": 12 }
                    ]
                }]
            }"#,
        )
        .expect("skill input deserializes");

        assert!(
            build_skill_effects(
                &raw.clone().into_domain().expect("converts").alternatives[0],
                1
            )
            .is_empty(),
            "an unannotated tiered effect is dropped, never assumed"
        );
        let report = build_skill_support_report(std::slice::from_ref(&raw)).expect("report builds");
        assert!(report[0].fully_unmodeled);
        assert_eq!(
            report[0].dropped_effects[0].reason,
            WasmUnmodeledReason::MissingPreAppliedMultiplier,
            "the fix is for the data to state its multiplier, not for the engine \
             to add a policy — so this must not read as an unsupported usage"
        );

        // The same effect, once it declares the tier already folded in, models.
        let annotated: WasmSkillInput = serde_json::from_str(
            r#"{
                "skillId": "210351",
                "rarity": 3,
                "alternatives": [{
                    "baseDuration": 30000,
                    "condition": "phase>=2",
                    "effects": [
                        { "modifier": 600, "target": 1, "type": 27, "valueUsage": 12,
                          "preAppliedMultiplier": 1.2 }
                    ]
                }]
            }"#,
        )
        .expect("skill input deserializes");

        let effects = build_skill_effects(
            &annotated.into_domain().expect("converts").alternatives[0],
            1,
        );
        assert_eq!(effects.len(), 1);
        assert_eq!(effects[0].value_scaling, ValueScalingPolicy::PreAppliedTier);
        // Passes through: the 1.2x is already in the stored 600.
        assert_eq!(effects[0].modifier, 0.06);
    }

    #[test]
    fn skill_input_drops_unroutable_target_effect_and_keeps_the_skill() {
        // Target 24 ("Spirited Cheers!", 109402111) has no engine routing. It used
        // to fail the whole conversion, which also made `skillSupportReport`
        // unusable on a full skill pool — the one call it is designed for.
        let dto: WasmSkillInput = serde_json::from_str(
            r#"{
                "skillId": "109402111",
                "rarity": 3,
                "alternatives": [{
                    "baseDuration": 30000,
                    "condition": "phase>=1",
                    "effects": [
                        { "modifier": 2500, "target": 1, "type": 27, "valueUsage": 1 },
                        { "modifier": 500, "target": 24, "type": 27, "valueUsage": 1 }
                    ]
                }]
            }"#,
        )
        .expect("skill input deserializes");

        let skill = dto
            .into_domain()
            .expect("target 24 no longer fails the skill");
        let effects = build_skill_effects(&skill.alternatives[0], 1);
        assert_eq!(effects.len(), 1, "only the target-24 effect is dropped");
        assert_eq!(effects[0].modifier, 0.25);
    }

    fn leveled_target_speed_input(level_json: &str) -> WasmSkillInput {
        // Shooting Star-shaped: one level-scaled Target Speed effect.
        serde_json::from_str(&format!(
            r#"{{
                "skillId": "100011",
                "rarity": 5,
                {level_json}
                "alternatives": [{{
                    "baseDuration": 50000,
                    "condition": "phase>=2",
                    "effects": [
                        {{ "modifier": 3500, "target": 1, "type": 27, "valueUsage": 1, "valueLevelUsage": 1 }}
                    ]
                }}]
            }}"#
        ))
        .expect("skill input deserializes")
    }

    #[test]
    fn skill_input_level_scales_flagged_effects() {
        let skill = leveled_target_speed_input(r#""level": 6,"#)
            .into_domain()
            .expect("converts");
        assert_eq!(skill.level, 6);
        let effects = build_skill_effects(&skill.alternatives[0], skill.level);
        assert!((effects[0].modifier - 0.35 * 1.13).abs() < 1e-12);
    }

    #[test]
    fn skill_input_without_level_is_level_one() {
        let skill = leveled_target_speed_input("")
            .into_domain()
            .expect("converts");
        assert_eq!(skill.level, 1);
        let effects = build_skill_effects(&skill.alternatives[0], skill.level);
        assert_eq!(effects[0].modifier, 0.35);
    }

    #[test]
    fn skill_input_rejects_out_of_range_level() {
        for level_json in [r#""level": 0,"#, r#""level": 11,"#] {
            let err = leveled_target_speed_input(level_json)
                .into_domain()
                .expect_err("out-of-range level is rejected");
            assert!(err.0.contains("skill level"), "{}", err.0);
        }
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
    fn skill_support_report_locates_drops_and_flags_inert_skills() {
        // The report must separate three cases the planner treats differently:
        // a partially modeled skill (still useful, understated), a skill left
        // with nothing to simulate, and a fully modeled skill (not reported).
        let skills: Vec<WasmSkillInput> = serde_json::from_str(
            r#"[
                {
                    "skillId": "210081",
                    "rarity": 3,
                    "alternatives": [{
                        "baseDuration": 30000,
                        "condition": "phase>=2",
                        "effects": [
                            { "modifier": 500, "target": 1, "type": 27, "valueUsage": 1 },
                            { "modifier": 500, "target": 1, "type": 27, "valueUsage": 12 }
                        ]
                    }]
                },
                {
                    "skillId": "vision-only",
                    "rarity": 1,
                    "alternatives": [{
                        "baseDuration": 10000,
                        "condition": "phase>=1",
                        "effects": [
                            { "modifier": 500, "target": 1, "type": 8, "valueUsage": 1 }
                        ]
                    }]
                },
                {
                    "skillId": "fully-modeled",
                    "rarity": 1,
                    "alternatives": [{
                        "baseDuration": 10000,
                        "condition": "phase>=1",
                        "effects": [
                            { "modifier": 500, "target": 1, "type": 27, "valueUsage": 1 }
                        ]
                    }]
                }
            ]"#,
        )
        .expect("skill inputs deserialize");

        let report = build_skill_support_report(&skills).expect("report builds");

        assert_eq!(
            report.len(),
            2,
            "the fully modeled skill is omitted from the report"
        );

        assert_eq!(report[0].skill_id, "210081");
        assert!(!report[0].fully_unmodeled, "the Direct effect survives");
        assert_eq!(
            report[0].dropped_effects,
            vec![WasmDroppedEffect {
                alternative_index: 0,
                effect_index: 1,
                reason: WasmUnmodeledReason::MissingPreAppliedMultiplier,
                value: 12,
            }]
        );

        assert_eq!(report[1].skill_id, "vision-only");
        assert!(
            report[1].fully_unmodeled,
            "nothing is left to simulate once the vision effect is dropped"
        );
        assert_eq!(
            report[1].dropped_effects[0].reason,
            WasmUnmodeledReason::UnmodeledEffectType
        );
        assert_eq!(report[1].dropped_effects[0].value, 8);
    }

    #[test]
    fn skill_support_report_indexes_against_the_submitted_payload() {
        // A target drop ahead of a value-usage drop in the same alternative. The
        // target effect never reaches the core classifier, so the core reports the
        // usage drop at its own index 1 — but the caller submitted it at index 2.
        // Reporting the core's index would point a consumer at the wrong effect.
        let skills: Vec<WasmSkillInput> = serde_json::from_str(
            r#"[{
                "skillId": "mixed-drops",
                "rarity": 3,
                "alternatives": [{
                    "baseDuration": 30000,
                    "condition": "phase>=1",
                    "effects": [
                        { "modifier": 500, "target": 24, "type": 27, "valueUsage": 1 },
                        { "modifier": 500, "target": 1, "type": 27, "valueUsage": 1 },
                        { "modifier": 500, "target": 1, "type": 27, "valueUsage": 12 }
                    ]
                }]
            }]"#,
        )
        .expect("skill inputs deserialize");

        let report = build_skill_support_report(&skills).expect("report builds");
        assert_eq!(report.len(), 1);
        assert_eq!(
            report[0].dropped_effects,
            vec![
                WasmDroppedEffect {
                    alternative_index: 0,
                    effect_index: 0,
                    reason: WasmUnmodeledReason::UnmodeledTarget,
                    value: 24,
                },
                WasmDroppedEffect {
                    alternative_index: 0,
                    effect_index: 2,
                    reason: WasmUnmodeledReason::MissingPreAppliedMultiplier,
                    value: 12,
                },
            ],
            "indices address the submitted payload, in submitted order"
        );
        assert!(!report[0].fully_unmodeled, "the middle effect survives");
    }

    #[test]
    fn skill_support_report_serializes_as_camel_case_for_js() {
        let skills: Vec<WasmSkillInput> = serde_json::from_str(
            r#"[{
                "skillId": "109402111",
                "rarity": 3,
                "alternatives": [{
                    "baseDuration": 50000,
                    "condition": "phase>=2",
                    "effects": [
                        { "modifier": 2500, "target": 1, "type": 27, "valueUsage": 1 },
                        { "modifier": 500, "target": 24, "type": 27, "valueUsage": 1 }
                    ]
                }]
            }]"#,
        )
        .expect("skill inputs deserialize");

        let report = build_skill_support_report(&skills).expect("report builds");
        let json = serde_json::to_string(&report).expect("serialize");

        assert!(
            json.contains("\"skillId\":\"109402111\""),
            "json was: {json}"
        );
        assert!(json.contains("\"droppedEffects\":"));
        assert!(json.contains("\"alternativeIndex\":0"));
        assert!(json.contains("\"effectIndex\":1"));
        assert!(json.contains("\"reason\":\"unmodeledTarget\""));
        assert!(json.contains("\"value\":24"));
        assert!(json.contains("\"fullyUnmodeled\":false"));
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
                    "rushedRunners": [true, false],
                    "witChecksRunners": [false, true],
                    "downhillRunners": [false, true],
                    "conservePowerRunners": [true, false],
                    "dueling": false,
                    "duelingRunners": [false, true],
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
        assert_eq!(domain.settings.rushed_runners, vec![true, false]);
        assert_eq!(domain.settings.wit_checks_runners, vec![false, true]);
        assert_eq!(domain.settings.downhill_runners, vec![false, true]);
        assert_eq!(domain.settings.conserve_power_runners, vec![true, false]);
        assert_eq!(domain.settings.dueling_runners, vec![false, true]);
        assert!(!domain.settings.dueling);
    }

    #[test]
    fn dueling_runners_reach_both_engines() {
        // One list, two settings structs: the per-runner flag has to survive both
        // conversions, or a mode silently falls back to the race default.
        let json = r#"{ "dueling": true, "duelingRunners": [false, true] }"#;
        let settings: WasmSettings = serde_json::from_str(json).expect("settings deserialize");

        let race = settings.clone().into_race_settings();
        assert_eq!(race.dueling_runners, vec![false, true]);
        assert!(race.dueling);

        let vacuum = settings.into_vacuum_settings();
        assert_eq!(vacuum.dueling_runners, vec![false, true]);
        assert!(vacuum.dueling);
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
    fn compare_settings_carry_per_runner_lists() {
        let dto: WasmCompareParams = serde_json::from_str(&minimal_contested_json(
            r#" "settings": { "rushed": true, "rushedRunners": [true, false], "witChecksRunners": [false, true], "downhillRunners": [false, true], "conservePowerRunners": [true, false], "syncRngRunners": [true, true] },"#,
        ))
        .expect("compare params deserialize with per-runner settings");
        let domain = dto.into_domain().expect("params convert to domain");
        assert_eq!(domain.settings.rushed_runners, vec![true, false]);
        assert_eq!(domain.settings.wit_checks_runners, vec![false, true]);
        assert_eq!(domain.settings.downhill_runners, vec![false, true]);
        assert_eq!(domain.settings.conserve_power_runners, vec![true, false]);
        assert_eq!(domain.settings.sync_rng_runners, vec![true, true]);
    }

    #[test]
    fn sync_rng_runners_default_to_none() {
        let dto: WasmCompareParams = serde_json::from_str(&minimal_contested_json(""))
            .expect("compare params deserialize without settings");
        let domain = dto.into_domain().expect("params convert to domain");
        // Runners share a stream only when the settings name them.
        assert!(domain.settings.sync_rng_runners.is_empty());
    }

    #[test]
    fn compare_focus_count_defaults_to_primary_only() {
        let dto: WasmCompareParams = serde_json::from_str(&minimal_contested_json(""))
            .expect("compare params deserialize without focusCount");
        let domain = dto.into_domain().expect("params convert to domain");
        assert_eq!(domain.focus_count, 1);
    }

    #[test]
    fn compare_focus_count_passes_through() {
        let dto: WasmCompareParams =
            serde_json::from_str(&minimal_contested_json(r#" "focusCount": 2,"#))
                .expect("compare params deserialize with focusCount");
        let domain = dto.into_domain().expect("params convert to domain");
        assert_eq!(domain.focus_count, 2);
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
    fn create_runner_carries_gate_and_forced_start_delay_when_present() {
        let pinned: WasmCreateRunner = serde_json::from_str(
            r#"{
                "outfitId": "test-outfit",
                "name": "Alpha",
                "mood": 0,
                "strategy": 1,
                "aptitudes": { "distance": 1, "strategy": 1, "surface": 1 },
                "stats": { "speed": 900, "stamina": 800, "power": 700, "guts": 600, "wit": 500 },
                "gate": 6,
                "forcedStartDelay": 0.0333,
                "forcedLastSpurtDistance": 1068.6
            }"#,
        )
        .expect("pinned runner parses");
        let domain = pinned.into_domain().expect("converts");
        assert_eq!(domain.gate, Some(6));
        assert_eq!(domain.forced_start_delay, Some(0.0333));
        assert_eq!(domain.forced_last_spurt_distance, Some(1068.6));

        let free: WasmCreateRunner = serde_json::from_str(
            r#"{
                "outfitId": "test-outfit",
                "name": "Beta",
                "mood": 0,
                "strategy": 1,
                "aptitudes": { "distance": 1, "strategy": 1, "surface": 1 },
                "stats": { "speed": 900, "stamina": 800, "power": 700, "guts": 600, "wit": 500 },
                "gate": null
            }"#,
        )
        .expect("free runner parses");
        let domain = free.into_domain().expect("converts");
        assert_eq!(domain.gate, None);
        assert_eq!(domain.forced_start_delay, None);
        assert_eq!(domain.forced_last_spurt_distance, None);
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

    /// A valid stamina-budget payload, with `extra` spliced in before the close.
    fn stamina_budget_json(extra: &str) -> String {
        format!(
            r#"{{
                "distance": 2400,
                "surface": 1,
                "ground": 1,
                "strategy": 3,
                "mood": 0,
                "stats": {{ "speed": 1200, "stamina": 1200, "power": 1000, "guts": 600, "wit": 1000 }},
                "distanceAptitude": 1,
                "strategyAptitude": 1{extra}
            }}"#
        )
    }

    fn budget_params(extra: &str) -> WasmStaminaBudgetParams {
        serde_json::from_str(&stamina_budget_json(extra)).expect("params deserialize")
    }

    #[test]
    fn stamina_budget_params_default_the_omitted_keys() {
        let domain = budget_params("").into_domain().expect("params convert");

        assert_eq!(domain.distance, 2400.0);
        assert_eq!(domain.surface, Surface::Turf);
        assert_eq!(domain.ground, GroundCondition::Firm);
        assert_eq!(domain.strategy, Strategy::LateSurger);
        assert_eq!(domain.mood, Mood::Normal);
        assert_eq!(domain.stats.stamina, 1200);
        // Absent recovery is none, and an absent status modifier is a clean run
        // — not a multiplier of zero, which would zero the whole bill.
        assert_eq!(domain.heal_basis_points, 0.0);
        assert_eq!(domain.status_modifier, 1.0);
        assert!(domain.course_set_status.is_empty());
    }

    #[test]
    fn stamina_budget_params_carry_recovery_and_course_stats() {
        let domain = budget_params(r#", "courseSetStatus": [1, 4], "healBasisPoints": 1500"#)
            .into_domain()
            .expect("params convert");

        assert_eq!(
            domain.course_set_status,
            vec![ThresholdStat::Speed, ThresholdStat::Guts]
        );
        assert_eq!(domain.heal_basis_points, 1500.0);
    }

    #[test]
    fn stamina_budget_rejects_zero_guts() {
        let json = stamina_budget_json("").replace(r#""guts": 600"#, r#""guts": 0"#);
        let dto: WasmStaminaBudgetParams = serde_json::from_str(&json).expect("deserialize");

        let error = dto.into_domain().expect_err("zero guts cannot be priced");
        assert!(error.to_string().contains("guts"), "{error}");
    }

    #[test]
    fn stamina_budget_rejects_a_non_positive_distance() {
        let json = stamina_budget_json("").replace(r#""distance": 2400"#, r#""distance": 0"#);
        let dto: WasmStaminaBudgetParams = serde_json::from_str(&json).expect("deserialize");

        let error = dto
            .into_domain()
            .expect_err("a zero-length course is not a course");
        assert!(error.to_string().contains("distance"), "{error}");
    }

    #[test]
    fn stamina_budget_rejects_a_negative_status_modifier() {
        let dto = budget_params(r#", "statusModifier": -1"#);

        let error = dto
            .into_domain()
            .expect_err("a negative multiplier is not a state");
        assert!(error.to_string().contains("statusModifier"), "{error}");
    }

    #[test]
    fn stamina_budget_rejects_an_unknown_course_stat() {
        let dto = budget_params(r#", "courseSetStatus": [9]"#);

        let error = dto.into_domain().expect_err("9 is not a stat");
        assert!(error.to_string().contains("courseSetStatus"), "{error}");
    }
}
