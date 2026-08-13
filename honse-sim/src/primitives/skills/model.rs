//! Skill **value objects** and runtime structs: [`Skill`], [`SkillAlternative`],
//! [`SkillEffectSpec`], [`ResolvedSkillEffect`], and the pending/active trigger
//! types.
//!
//! Ports `skills/skill.types.ts`. The input DTOs ([`Skill`], [`SkillAlternative`],
//! [`RawSkillEffect`]) arrive from the TypeScript data layer and so derive serde
//! with `camelCase` field names. The runtime structs ([`SkillTrigger`],
//! [`PendingSkill`], [`ActiveSkill`], …) live entirely inside the simulation and
//! carry domain types ([`ActivationSamplePolicy`], [`DynamicCondition`]) that do
//! not cross the boundary, so they do not derive serde.

use serde::{Deserialize, Serialize};

use crate::shared_kernel::ids::{RunnerId, SkillId};
use crate::shared_kernel::language::Strategy;
use crate::shared_kernel::math::Timer;
use crate::shared_kernel::region::{Region, RegionList};
use crate::skills::activation::ActivationSamplePolicy;
use crate::skills::condition::dynamic::DynamicCondition;
use crate::skills::effect::{SkillRarity, SkillTarget, SkillType};
use crate::skills::value_scaling::ValueScalingPolicy;

/// Raw effect as it appears in the skill data, before duration is attached and
/// modifiers are scaled.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawSkillEffect {
    /// Effect strength in raw (×10000) units.
    pub modifier: f64,
    /// Target selector.
    pub target: SkillTarget,
    /// Raw effect type id (mapped to [`SkillType`] when built).
    #[serde(rename = "type")]
    pub effect_type: i32,
    /// Optional usage discriminator (e.g. recovery sub-mode).
    #[serde(default)]
    pub value_usage: Option<i32>,
    /// Optional level-usage discriminator.
    #[serde(default)]
    pub value_level_usage: Option<i32>,
    /// The value-scaling tier multiplier the data extract has **already applied**
    /// to `modifier`, when it did.
    ///
    /// Only meaningful for the tiered usages ([`ValueScalingPolicy::PreAppliedTier`]).
    /// Its presence is the authority on whether pre-application happened: the
    /// extract gates that per *skill*, not per usage, so the same usage can arrive
    /// pre-scaled on one skill and raw on another. Absent on a tiered usage means
    /// the tier is unknown and the effect is dropped — the engine never assumes a
    /// tier it was not told about, because assuming would understate the effect by
    /// up to 1.2x with no way to notice.
    #[serde(default)]
    pub pre_applied_multiplier: Option<f64>,
}

/// A single alternative (condition branch) of a skill's effect data.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillAlternative {
    /// Base duration in raw (×10000) units.
    pub base_duration: f64,
    /// Optional cooldown between activations (raw units).
    #[serde(default)]
    pub cooldown_time: Option<f64>,
    /// The activation condition DSL string.
    pub condition: String,
    /// Optional precondition DSL string.
    #[serde(default)]
    pub precondition: Option<String>,
    /// Raw effects this alternative applies.
    pub effects: Vec<RawSkillEffect>,
}

/// A skill as loaded from the data layer (input DTO).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    /// Skill identifier.
    pub skill_id: SkillId,
    /// Rarity tier.
    pub rarity: SkillRarity,
    /// Authoritative master-data tags carried from `skill_data.tag_id`.
    #[serde(default)]
    pub tags: Vec<i32>,
    /// Condition branches; the first satisfiable one is used.
    pub alternatives: Vec<SkillAlternative>,
}

/// A built, **normalized** effect specification (value object). `base_duration`
/// and `modifier` are in real units (the raw ×10000 values divided by 10000).
///
/// A spec carries a *base* modifier and the [`ValueScalingPolicy`] that governs
/// how the runtime modifier is derived from it. It is deliberately distinct from
/// [`ResolvedSkillEffect`] so a resolved value can never be re-resolved.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SkillEffectSpec {
    /// Target selector.
    pub target: SkillTarget,
    /// Effect type.
    pub effect_type: SkillType,
    /// Effect duration in seconds.
    pub base_duration: f64,
    /// Base effect strength in real units (before value scaling).
    pub modifier: f64,
    /// How the runtime modifier is derived from `modifier`.
    pub value_scaling: ValueScalingPolicy,
    /// Optional level-usage discriminator (carried only; level scaling is out of
    /// scope for value resolution).
    pub value_level_usage: Option<i32>,
}

/// A runtime-**resolved** effect: the value-scaling policy has already been
/// applied, yielding a concrete `modifier`. Produced from a [`SkillEffectSpec`]
/// exactly once by the caster before self/target routing, so it can never be
/// resolved again.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ResolvedSkillEffect {
    /// Target selector.
    pub target: SkillTarget,
    /// Effect type.
    pub effect_type: SkillType,
    /// Effect duration in seconds.
    pub base_duration: f64,
    /// Resolved effect strength in real units.
    pub modifier: f64,
}

/// Why the engine cannot faithfully model a raw effect, and so drops it.
///
/// Every variant means "this effect does not participate in the simulation at
/// all". None is coerced to a stand-in value: an unmodeled effect contributes
/// nothing rather than contributing a guess.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnmodeledEffect {
    /// The raw type id has no [`SkillType`] mapping (vision `8`, temptation
    /// `13`, carnival/event `502`/`503`, ...). Carries the raw id.
    EffectType(i32),
    /// The `value_usage` has no [`ValueScalingPolicy`] mapping, so the runtime
    /// value cannot be derived. Carries the raw usage.
    ValueUsage(i32),
    /// A [`ValueScalingPolicy::PreAppliedTier`] usage arrived without a
    /// `pre_applied_multiplier`, so which tier (if any) is baked into `modifier`
    /// is unknown. Carries the raw usage.
    ///
    /// Distinct from [`Self::ValueUsage`]: the engine models this usage, and the
    /// fix is for the data to state the multiplier it applied rather than for the
    /// engine to add a policy.
    MissingPreAppliedMultiplier(i32),
}

/// Classify one raw effect: the built spec, or why it cannot be modeled.
///
/// The single decision point behind both [`build_skill_effects`] (which keeps
/// the `Ok`s) and [`unmodeled_effects`] (which reports the `Err`s), so a
/// consumer-facing support report can never disagree with what the simulation
/// actually runs.
///
/// Effect type is checked before value usage, so an effect failing both is
/// reported as [`UnmodeledEffect::EffectType`].
fn classify_effect(
    effect: &RawSkillEffect,
    base_duration: f64,
) -> Result<SkillEffectSpec, UnmodeledEffect> {
    let effect_type = SkillType::try_from(effect.effect_type)
        .map_err(|_| UnmodeledEffect::EffectType(effect.effect_type))?;
    let value_scaling = ValueScalingPolicy::from_value_usage(effect.value_usage)
        .map_err(|e| UnmodeledEffect::ValueUsage(e.0))?;
    // A tiered value is only trustworthy when the data says which tier it already
    // carries. Passing an unannotated modifier through would silently understate
    // the effect by up to 1.2x, which is worse than dropping it: a plausible
    // wrong number instead of an obviously missing one.
    if value_scaling == ValueScalingPolicy::PreAppliedTier
        && effect.pre_applied_multiplier.is_none()
    {
        return Err(UnmodeledEffect::MissingPreAppliedMultiplier(
            effect.value_usage.unwrap_or_default(),
        ));
    }
    Ok(SkillEffectSpec {
        target: effect.target,
        effect_type,
        base_duration,
        modifier: effect.modifier / 10000.0,
        value_scaling,
        value_level_usage: effect.value_level_usage,
    })
}

/// Build the scaled [`SkillEffectSpec`]s for one alternative.
///
/// Port of `buildSkillEffects`: `base_duration` and every `modifier` are divided
/// by `10000`, and the raw type id is resolved to a [`SkillType`].
///
/// Effects the engine cannot model are **skipped**, not fatal — see
/// [`UnmodeledEffect`] for the two reasons. The game bundles unmodeled effects
/// alongside ones we do model — e.g. every Savvy skill carries Wisdom Up (`5`)
/// *and* a vision effect (`8`). Rejecting the whole alternative silently killed
/// the entire skill (no trigger, no stat bonus, no proc). Dropping only the
/// unmodeled effect keeps the known ones live. An alternative whose effects are
/// *all* unmodeled yields an empty list, which `build_skill_data` treats as "no
/// trigger" (correct — there is nothing to simulate).
///
/// Dropping loses a contribution; coercing an unsupported `value_usage` to
/// `Direct` would instead invent one, applying a tier we cannot cite as though it
/// were the measured value. So dropping is deliberate, and a usage only becomes
/// [`ValueScalingPolicy::PreAppliedTier`] when the mechanics reference
/// documents the tier the extract bakes in. [`unmodeled_effects`] reports what
/// was lost.
pub fn build_skill_effects(alt: &SkillAlternative) -> Vec<SkillEffectSpec> {
    let base_duration = alt.base_duration / 10000.0;
    alt.effects
        .iter()
        .filter_map(|effect| classify_effect(effect, base_duration).ok())
        .collect()
}

/// The effects of `alt` that [`build_skill_effects`] drops, as
/// `(effect_index, reason)` over the alternative's raw effect list.
///
/// Empty means the alternative is modeled in full. Exposed so a consumer can
/// tell a user that a skill is only partially simulated instead of letting the
/// gap pass unnoticed.
pub fn unmodeled_effects(alt: &SkillAlternative) -> Vec<(usize, UnmodeledEffect)> {
    let base_duration = alt.base_duration / 10000.0;
    alt.effects
        .iter()
        .enumerate()
        .filter_map(|(index, effect)| {
            classify_effect(effect, base_duration)
                .err()
                .map(|reason| (index, reason))
        })
        .collect()
}

/// Where a targeted (injected) skill originated.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TargetedSkillOrigin {
    /// Injected externally (e.g. a debuff test harness).
    Injection,
    /// Cast by another runner during the race.
    Runner,
}

/// A skill prepared for activation: its sampled trigger windows plus the runtime
/// predicate that gates it.
///
/// No `PartialEq`: it holds a dynamic-condition closure (see
/// [`DynamicCondition`]). `extra_condition` is `None` when no runtime gate is
/// needed (`kTrue`).
#[derive(Debug, Clone)]
pub struct SkillTrigger {
    /// Skill identifier.
    pub skill_id: SkillId,
    /// Rarity tier (1★/2★ uniques, upgrades, and 3★ uniques differ here).
    pub rarity: SkillRarity,
    /// Authoritative master-data tags (`skill_data.tag_id`), carried so the
    /// activated-skill ledger can classify green activations.
    pub tags: Vec<i32>,
    /// How activation windows are sampled.
    pub sample_policy: ActivationSamplePolicy,
    /// Candidate activation windows.
    pub regions: RegionList,
    /// Effects applied on activation.
    pub effects: Vec<SkillEffectSpec>,
    /// Extra runtime gate evaluated each tick (`None` == always-true).
    pub extra_condition: Option<DynamicCondition>,
    /// For `EnemyStrategy`-targeted (and Kakari-strategy) external debuffs, the
    /// running style the debuff hits — derived from the activation condition
    /// (`running_style_count_<style>_otherself`), since the effect data does not
    /// carry it. `None` for skills whose targeting needs no strategy.
    pub target_strategy: Option<Strategy>,
}

/// A skill whose trigger point has been fixed, awaiting the runner reaching it.
///
/// No `PartialEq`: it holds a dynamic-condition closure.
#[derive(Debug, Clone)]
pub struct PendingSkill {
    /// Skill identifier.
    pub skill_id: SkillId,
    /// Rarity tier.
    pub rarity: SkillRarity,
    /// Authoritative master-data tags (`skill_data.tag_id`), recorded into the
    /// activated-skill ledger when this skill activates.
    pub tags: Vec<i32>,
    /// The concrete trigger window.
    pub trigger: Region,
    /// Effects applied on activation.
    pub effects: Vec<SkillEffectSpec>,
    /// Extra runtime gate evaluated each tick (`None` == always-true).
    pub extra_condition: Option<DynamicCondition>,
    /// Derived target running style for `EnemyStrategy` external debuffs (see
    /// [`SkillTrigger::target_strategy`]).
    pub target_strategy: Option<Strategy>,
    /// User-forced activation (scripted `forcedPositions`): the skill fires
    /// unconditionally when the runner reaches its trigger window — dynamic
    /// condition gates and the wit check are bypassed, matching injected-debuff
    /// semantics.
    pub forced: bool,
}

/// An opponent-facing (external) debuff a runner emitted this frame, awaiting the
/// race aggregate to route it onto the resolved target runners. Emitted by the
/// caster during its update; consumed by the aggregate's coordinator pass (the
/// caster never applies it to itself).
#[derive(Debug, Clone, PartialEq)]
pub struct EmittedDebuff {
    /// The skill that produced the debuff.
    pub skill_id: SkillId,
    /// The single external-debuff effect to apply to each target, already
    /// **resolved** by the caster (its value-scaling policy has been applied
    /// against caster state). The receiving runner only scales duration by
    /// course distance; it must never re-resolve the value.
    pub effect: ResolvedSkillEffect,
    /// The effect's target selector.
    pub target: SkillTarget,
    /// Derived target running style for `EnemyStrategy`/`KakariStrategy`.
    pub target_strategy: Option<Strategy>,
}

/// A targeted (debuff/ally) skill awaiting its trigger point.
#[derive(Debug, Clone, PartialEq)]
pub struct PendingTargetedSkill {
    /// Skill identifier.
    pub skill_id: SkillId,
    /// Where this targeted skill came from.
    pub origin: TargetedSkillOrigin,
    /// The source runner, when cast by another runner.
    pub source_runner_id: Option<RunnerId>,
    /// The concrete trigger window.
    pub trigger: Region,
    /// Effects applied on activation.
    pub effects: Vec<SkillEffectSpec>,
}

/// A currently-active effect on a runner (duration-based).
#[derive(Debug, Clone, PartialEq)]
pub struct ActiveSkill {
    /// Skill identifier.
    pub skill_id: SkillId,
    /// Remaining-duration timer.
    pub duration_timer: Timer,
    /// Effect strength in real units.
    pub modifier: f64,
    /// Target selector.
    pub effect_target: SkillTarget,
    /// Effect type.
    pub effect_type: SkillType,
    /// Whether the current-speed effect decays naturally on expiry (adds a
    /// one-frame acceleration when it ends).
    pub natural_deceleration: bool,
}

/// A currently-active targeted (debuff/ally) effect on a runner.
#[derive(Debug, Clone, PartialEq)]
pub struct ActiveTargetedSkill {
    /// The underlying active effect.
    pub skill: ActiveSkill,
    /// Where this targeted skill came from.
    pub origin: TargetedSkillOrigin,
    /// The source runner, when cast by another runner.
    pub source_runner_id: Option<RunnerId>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_skill_effects_scales_by_10000() {
        let alt = SkillAlternative {
            base_duration: 30000.0,
            cooldown_time: None,
            condition: "phase>=2".to_owned(),
            precondition: None,
            effects: vec![
                RawSkillEffect {
                    modifier: 4500.0,
                    target: SkillTarget::SelfTarget,
                    effect_type: 27,
                    value_usage: None,
                    value_level_usage: None,
                    pre_applied_multiplier: None,
                },
                RawSkillEffect {
                    modifier: -10000.0,
                    target: SkillTarget::All,
                    effect_type: 9,
                    value_usage: Some(8),
                    value_level_usage: None,
                    pre_applied_multiplier: None,
                },
            ],
        };
        let effects = build_skill_effects(&alt);
        assert_eq!(effects.len(), 2);
        assert_eq!(effects[0].base_duration, 3.0);
        assert_eq!(effects[0].modifier, 0.45);
        assert_eq!(effects[0].effect_type, SkillType::TargetSpeed);
        assert_eq!(effects[1].modifier, -1.0);
        assert_eq!(effects[1].effect_type, SkillType::Recovery);
        assert_eq!(effects[1].value_scaling, ValueScalingPolicy::MultiplyRandom);
    }

    #[test]
    fn build_skill_effects_skips_unknown_type_and_keeps_known() {
        // Regression: a Savvy-shaped alternative bundles Wisdom Up (5, modeled)
        // with a vision effect (8, unmodeled). The unknown type must be dropped,
        // not reject the whole alternative — otherwise the skill silently never
        // activates and the wit bonus is lost.
        let alt = SkillAlternative {
            base_duration: -10000.0,
            cooldown_time: None,
            condition: "running_style==2".to_owned(),
            precondition: None,
            effects: vec![
                RawSkillEffect {
                    modifier: 600000.0,
                    target: SkillTarget::SelfTarget,
                    effect_type: 5, // Wisdom Up (modeled)
                    value_usage: Some(1),
                    value_level_usage: Some(1),
                    pre_applied_multiplier: None,
                },
                RawSkillEffect {
                    modifier: 100000.0,
                    target: SkillTarget::SelfTarget,
                    effect_type: 8, // vision (unmodeled)
                    value_usage: Some(1),
                    value_level_usage: Some(1),
                    pre_applied_multiplier: None,
                },
            ],
        };
        let effects = build_skill_effects(&alt);
        assert_eq!(effects.len(), 1, "the unmodeled type-8 effect is dropped");
        assert_eq!(effects[0].effect_type, SkillType::WisdomUp);
        assert_eq!(effects[0].modifier, 60.0);
    }

    #[test]
    fn unmodeled_effects_reports_exactly_what_build_drops() {
        // One effect per drop reason plus a modeled Direct one: an unsupported
        // usage (19), a tiered usage that never said which tier it carries (12),
        // and an unmodeled effect type (8). The report and the builder must
        // partition the same list — anything else means a consumer is told
        // something the simulation does not do.
        let alt = SkillAlternative {
            base_duration: 50000.0,
            cooldown_time: None,
            condition: "phase>=2".to_owned(),
            precondition: None,
            effects: vec![
                RawSkillEffect {
                    modifier: 2500.0,
                    target: SkillTarget::SelfTarget,
                    effect_type: 27,
                    value_usage: Some(1),
                    value_level_usage: None,
                    pre_applied_multiplier: None,
                },
                RawSkillEffect {
                    modifier: 500.0,
                    target: SkillTarget::SelfTarget,
                    effect_type: 27,
                    value_usage: Some(12),
                    value_level_usage: None,
                    pre_applied_multiplier: None,
                },
                RawSkillEffect {
                    modifier: 500.0,
                    target: SkillTarget::SelfTarget,
                    effect_type: 8,
                    value_usage: Some(1),
                    value_level_usage: None,
                    pre_applied_multiplier: None,
                },
                RawSkillEffect {
                    modifier: 500.0,
                    target: SkillTarget::SelfTarget,
                    effect_type: 27,
                    value_usage: Some(19),
                    value_level_usage: None,
                    pre_applied_multiplier: None,
                },
            ],
        };

        assert_eq!(
            unmodeled_effects(&alt),
            vec![
                (1, UnmodeledEffect::MissingPreAppliedMultiplier(12)),
                (2, UnmodeledEffect::EffectType(8)),
                (3, UnmodeledEffect::ValueUsage(19)),
            ]
        );
        assert_eq!(
            build_skill_effects(&alt).len() + unmodeled_effects(&alt).len(),
            alt.effects.len(),
            "every raw effect is either built or reported, never both or neither"
        );
    }

    #[test]
    fn unmodeled_effects_is_empty_for_a_fully_modeled_alternative() {
        let alt = SkillAlternative {
            base_duration: 30000.0,
            cooldown_time: None,
            condition: "phase>=2".to_owned(),
            precondition: None,
            effects: vec![RawSkillEffect {
                modifier: 4500.0,
                target: SkillTarget::SelfTarget,
                effect_type: 27,
                value_usage: None,
                value_level_usage: None,
                pre_applied_multiplier: None,
            }],
        };
        assert!(unmodeled_effects(&alt).is_empty());
    }

    #[test]
    fn build_skill_effects_all_unknown_yields_empty() {
        let alt = SkillAlternative {
            base_duration: 0.0,
            cooldown_time: None,
            condition: String::new(),
            precondition: None,
            effects: vec![RawSkillEffect {
                modifier: 1.0,
                target: SkillTarget::SelfTarget,
                effect_type: 999,
                value_usage: None,
                value_level_usage: None,
                pre_applied_multiplier: None,
            }],
        };
        assert!(build_skill_effects(&alt).is_empty());
    }

    #[test]
    fn skill_dto_round_trips_with_camel_case_fields() {
        // The raw JS->domain numeric-enum mapping lives in the wasm `dto.rs`
        // boundary layer; core round-trips through its own symmetric serde
        // representation. This asserts the `camelCase` field naming and the raw
        // `type` rename survive a round trip.
        let skill = Skill {
            skill_id: SkillId::new("100012"),
            rarity: SkillRarity::Gold,
            tags: vec![401, 608],
            alternatives: vec![SkillAlternative {
                base_duration: 12000.0,
                cooldown_time: Some(2000.0),
                condition: "phase>=1".to_owned(),
                precondition: None,
                effects: vec![RawSkillEffect {
                    modifier: 3000.0,
                    target: SkillTarget::SelfTarget,
                    effect_type: 27,
                    value_usage: None,
                    value_level_usage: None,
                    pre_applied_multiplier: None,
                }],
            }],
        };
        let json = serde_json::to_string(&skill).expect("serialize");
        assert!(json.contains("\"skillId\":"), "json was: {json}");
        assert!(json.contains("\"baseDuration\":12000"));
        assert!(json.contains("\"cooldownTime\":2000"));
        assert!(json.contains("\"type\":27"));

        let reparsed: Skill = serde_json::from_str(&json).expect("parse");
        assert_eq!(reparsed, skill);
    }
}
