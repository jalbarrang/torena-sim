//! Semantic policies for resolving a skill effect's runtime value.

use crate::shared_kernel::rng::Prng;
use crate::skills::effect::SkillType;
use crate::skills::model::SkillEffectSpec;

/// Multiply-random low factor (30% roll bucket).
pub const MULTIPLY_RANDOM_LOW: f64 = 0.02;
/// Multiply-random high factor (10% roll bucket).
pub const MULTIPLY_RANDOM_HIGH: f64 = 0.04;

/// The value-resolution behavior encoded by `ability_value_usage`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ValueScalingPolicy {
    /// No runtime value scaling.
    Direct,
    /// The effect is multiplied by one random 0×/0.02×/0.04× roll.
    MultiplyRandom,
    /// Aoharu-scenario team-stats scaling (usages 3–7). The multiplier tier is
    /// driven by the training team's total base stats, a datum that only exists
    /// inside the Aoharu scenario. Outside the scenario (CM / Team Trials — the
    /// races this simulator models) the game applies the base value unchanged
    /// (1.0×), so this policy resolves to the direct modifier. See
    /// docs/mechanics/README.md § "Aoharu Skills (3-7)".
    MultiplyAoharuTeamStats,
    /// Reserved for usage 14, enabled once activated-tag state exists.
    MultiplyActivatedTaggedSkillCount,
}

/// Whether a raw value usage requires *caster* context (read-only activated-skill
/// state) to resolve, and so cannot be resolved for an injected effect that has
/// no caster. Usage 14 counts the caster's activated green skills.
pub fn requires_caster_context(value_usage: Option<i32>) -> bool {
    matches!(value_usage, Some(14))
}

/// A raw usage the simulator cannot faithfully evaluate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UnsupportedValueUsage(pub i32);

impl std::fmt::Display for UnsupportedValueUsage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "unsupported skill effect value usage {}", self.0)
    }
}

impl std::error::Error for UnsupportedValueUsage {}

impl ValueScalingPolicy {
    /// Convert the source-data usage into a policy supported at this migration step.
    pub fn from_value_usage(value_usage: Option<i32>) -> Result<Self, UnsupportedValueUsage> {
        match value_usage {
            None | Some(1) => Ok(Self::Direct),
            Some(3..=7) => Ok(Self::MultiplyAoharuTeamStats),
            Some(8 | 9) => Ok(Self::MultiplyRandom),
            Some(14) => Ok(Self::MultiplyActivatedTaggedSkillCount),
            Some(value) => Err(UnsupportedValueUsage(value)),
        }
    }

    /// Validate effect-type combinations before a skill reaches the runtime.
    pub fn supports_effect_type(self, effect_type: SkillType) -> bool {
        match self {
            Self::Direct => true,
            // Resolves as the direct value outside the Aoharu scenario; no
            // type restriction (Ignited Spirit scales Acceleration).
            Self::MultiplyAoharuTeamStats => true,
            Self::MultiplyRandom => effect_type == SkillType::Recovery,
            // Usage 14 is a generic count-based value multiplier (Copano Rickey
            // scales Target Speed and Acceleration); not restricted by type.
            Self::MultiplyActivatedTaggedSkillCount => true,
        }
    }
}

/// Read-only activation state plus the skill RNG a value policy may need to
/// resolve one effect's runtime modifier.
///
/// [`ValueScalingPolicy::MultiplyRandom`] needs the RNG;
/// [`ValueScalingPolicy::MultiplyActivatedTaggedSkillCount`] (usage 14) needs the
/// activated green-skill count. The caster resolves each effect once against
/// this context before self/target routing, so an emitted (routed) effect is
/// already data and is never resolved again by the receiver.
pub struct EffectResolutionContext<'a> {
    skill_rng: Option<&'a mut dyn Prng>,
    /// Number of distinct activated skills carrying a green tag (601–615).
    activated_green_count: usize,
}

impl<'a> EffectResolutionContext<'a> {
    /// Build a resolution context from an optional skill RNG (green count 0).
    pub fn new(skill_rng: Option<&'a mut dyn Prng>) -> Self {
        Self {
            skill_rng,
            activated_green_count: 0,
        }
    }

    /// Set the activated green-skill count used by caster-context scaling.
    pub fn with_activated_green_count(mut self, count: usize) -> Self {
        self.activated_green_count = count;
        self
    }
}

/// Why an effect's runtime modifier could not be resolved.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResolveError {
    /// A [`ValueScalingPolicy::MultiplyRandom`] effect reached resolution with no
    /// skill RNG to roll against.
    MissingSkillRng,
    /// The policy cannot resolve this effect: either an invalid effect-type
    /// combination (e.g. MultiplyRandom on a non-Recovery effect) or a policy
    /// not yet enabled at this migration step.
    UnsupportedForEffect(ValueScalingPolicy),
}

impl std::fmt::Display for ResolveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingSkillRng => {
                write!(f, "skillRng is required to resolve MultiplyRandom effects")
            }
            Self::UnsupportedForEffect(policy) => {
                write!(
                    f,
                    "value scaling policy {policy:?} cannot resolve this effect"
                )
            }
        }
    }
}

impl std::error::Error for ResolveError {}

/// Value multiplier for [`ValueScalingPolicy::MultiplyActivatedTaggedSkillCount`]
/// (usage 14): activated green-skill count → multiplier tier.
///
/// `0..=2 → 0×`, `3..=4 → 1×`, `5 → 2×`, `6+ → 3×`.
pub fn activated_tagged_multiplier(activated_green_count: usize) -> f64 {
    match activated_green_count {
        0..=2 => 0.0,
        3..=4 => 1.0,
        5 => 2.0,
        _ => 3.0,
    }
}

/// Resolve one effect spec's runtime modifier under its value-scaling policy.
///
/// - [`ValueScalingPolicy::Direct`] returns the base modifier unchanged.
/// - [`ValueScalingPolicy::MultiplyRandom`] (Recovery only) rolls once, consuming
///   exactly one skill-RNG draw: 60% → `0.0`, 30% → `base × 0.02`, 10% →
///   `base × 0.04`. A non-Recovery effect is rejected (the DTO backstop already
///   refuses to build such a skill; this is defense in depth).
/// - [`ValueScalingPolicy::MultiplyActivatedTaggedSkillCount`] (usage 14) is
///   enabled in a later step and rejected here.
pub fn resolve_modifier(
    effect: &SkillEffectSpec,
    context: &mut EffectResolutionContext<'_>,
) -> Result<f64, ResolveError> {
    match effect.value_scaling {
        ValueScalingPolicy::Direct => Ok(effect.modifier),
        // 1.0× outside the Aoharu scenario; see the variant doc comment.
        ValueScalingPolicy::MultiplyAoharuTeamStats => Ok(effect.modifier),
        ValueScalingPolicy::MultiplyRandom => {
            if effect.effect_type != SkillType::Recovery {
                return Err(ResolveError::UnsupportedForEffect(
                    ValueScalingPolicy::MultiplyRandom,
                ));
            }
            let rng = context
                .skill_rng
                .as_deref_mut()
                .ok_or(ResolveError::MissingSkillRng)?;
            let roll = rng.random();
            Ok(if roll < 0.6 {
                0.0
            } else if roll < 0.9 {
                effect.modifier * MULTIPLY_RANDOM_LOW
            } else {
                effect.modifier * MULTIPLY_RANDOM_HIGH
            })
        }
        ValueScalingPolicy::MultiplyActivatedTaggedSkillCount => {
            Ok(effect.modifier * activated_tagged_multiplier(context.activated_green_count))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_only_currently_supported_raw_usages() {
        assert_eq!(
            ValueScalingPolicy::from_value_usage(None),
            Ok(ValueScalingPolicy::Direct)
        );
        assert_eq!(
            ValueScalingPolicy::from_value_usage(Some(1)),
            Ok(ValueScalingPolicy::Direct)
        );
        assert_eq!(
            ValueScalingPolicy::from_value_usage(Some(8)),
            Ok(ValueScalingPolicy::MultiplyRandom)
        );
        assert_eq!(
            ValueScalingPolicy::from_value_usage(Some(9)),
            Ok(ValueScalingPolicy::MultiplyRandom)
        );
        assert_eq!(
            ValueScalingPolicy::from_value_usage(Some(14)),
            Ok(ValueScalingPolicy::MultiplyActivatedTaggedSkillCount)
        );
        for usage in 3..=7 {
            assert_eq!(
                ValueScalingPolicy::from_value_usage(Some(usage)),
                Ok(ValueScalingPolicy::MultiplyAoharuTeamStats)
            );
        }
        assert_eq!(
            ValueScalingPolicy::from_value_usage(Some(13)),
            Err(UnsupportedValueUsage(13))
        );
    }

    #[test]
    fn multiply_random_is_recovery_only() {
        assert!(ValueScalingPolicy::MultiplyRandom.supports_effect_type(SkillType::Recovery));
        assert!(!ValueScalingPolicy::MultiplyRandom.supports_effect_type(SkillType::TargetSpeed));
    }

    use crate::skills::effect::SkillTarget;

    /// RNG stub returning a fixed `random()` value.
    struct FixedRng(f64);
    impl Prng for FixedRng {
        fn int32(&mut self) -> u32 {
            0
        }
        fn random(&mut self) -> f64 {
            self.0
        }
        fn uniform(&mut self, _upper: u32) -> u32 {
            0
        }
    }

    fn spec(
        effect_type: SkillType,
        modifier: f64,
        value_scaling: ValueScalingPolicy,
    ) -> SkillEffectSpec {
        SkillEffectSpec {
            target: SkillTarget::SelfTarget,
            effect_type,
            base_duration: 0.0,
            modifier,
            value_scaling,
            value_level_usage: None,
        }
    }

    #[test]
    fn direct_returns_base_modifier_without_rolling() {
        let effect = spec(SkillType::TargetSpeed, 0.25, ValueScalingPolicy::Direct);
        let mut ctx = EffectResolutionContext::new(None);
        assert_eq!(resolve_modifier(&effect, &mut ctx), Ok(0.25));
    }

    #[test]
    fn aoharu_team_stats_resolves_to_base_modifier_outside_scenario() {
        // Ignited Spirit (210031/210032): Acceleration with usage 5. Outside
        // the Aoharu scenario the game applies no team-stats bonus.
        let effect = spec(
            SkillType::Accel,
            0.2,
            ValueScalingPolicy::MultiplyAoharuTeamStats,
        );
        let mut ctx = EffectResolutionContext::new(None);
        assert_eq!(resolve_modifier(&effect, &mut ctx), Ok(0.2));
        assert!(ValueScalingPolicy::MultiplyAoharuTeamStats.supports_effect_type(SkillType::Accel));
    }

    #[test]
    fn multiply_random_rolls_recovery_buckets() {
        let effect = spec(SkillType::Recovery, 1.0, ValueScalingPolicy::MultiplyRandom);
        let mut nothing = FixedRng(0.5);
        let mut low = FixedRng(0.7);
        let mut high = FixedRng(0.95);
        assert_eq!(
            resolve_modifier(
                &effect,
                &mut EffectResolutionContext::new(Some(&mut nothing))
            ),
            Ok(0.0)
        );
        assert_eq!(
            resolve_modifier(&effect, &mut EffectResolutionContext::new(Some(&mut low))),
            Ok(0.02)
        );
        assert_eq!(
            resolve_modifier(&effect, &mut EffectResolutionContext::new(Some(&mut high))),
            Ok(0.04)
        );
    }

    #[test]
    fn multiply_random_requires_rng() {
        let effect = spec(SkillType::Recovery, 1.0, ValueScalingPolicy::MultiplyRandom);
        let mut ctx = EffectResolutionContext::new(None);
        assert_eq!(
            resolve_modifier(&effect, &mut ctx),
            Err(ResolveError::MissingSkillRng)
        );
    }

    #[test]
    fn multiply_random_rejects_non_recovery_effect() {
        let effect = spec(
            SkillType::TargetSpeed,
            1.0,
            ValueScalingPolicy::MultiplyRandom,
        );
        let mut roll = FixedRng(0.95);
        let mut ctx = EffectResolutionContext::new(Some(&mut roll));
        assert_eq!(
            resolve_modifier(&effect, &mut ctx),
            Err(ResolveError::UnsupportedForEffect(
                ValueScalingPolicy::MultiplyRandom
            ))
        );
    }

    #[test]
    fn activated_tagged_multiplier_tiers() {
        assert_eq!(activated_tagged_multiplier(0), 0.0);
        assert_eq!(activated_tagged_multiplier(2), 0.0);
        assert_eq!(activated_tagged_multiplier(3), 1.0);
        assert_eq!(activated_tagged_multiplier(4), 1.0);
        assert_eq!(activated_tagged_multiplier(5), 2.0);
        assert_eq!(activated_tagged_multiplier(6), 3.0);
        assert_eq!(activated_tagged_multiplier(9), 3.0);
    }

    #[test]
    fn luck_runs_my_way_resolves_each_effect_independently() {
        // Copano Rickey's Luck Runs My Way (100981): a Direct Target Speed plus a
        // usage-14 Target Speed and a usage-14 Acceleration. The two Target Speed
        // effects must resolve independently (never merged before resolution).
        use crate::skills::model::{build_skill_effects, RawSkillEffect, SkillAlternative};
        let alt = SkillAlternative {
            base_duration: 50000.0,
            cooldown_time: None,
            condition: "phase>=2".to_owned(),
            precondition: None,
            effects: vec![
                RawSkillEffect {
                    modifier: 2500.0,
                    target: SkillTarget::SelfTarget,
                    effect_type: 27, // Target Speed, Direct
                    value_usage: Some(1),
                    value_level_usage: None,
                },
                RawSkillEffect {
                    modifier: 500.0,
                    target: SkillTarget::SelfTarget,
                    effect_type: 27, // Target Speed, usage 14
                    value_usage: Some(14),
                    value_level_usage: None,
                },
                RawSkillEffect {
                    modifier: 500.0,
                    target: SkillTarget::SelfTarget,
                    effect_type: 31, // Acceleration, usage 14
                    value_usage: Some(14),
                    value_level_usage: None,
                },
            ],
        };
        let specs = build_skill_effects(&alt);
        assert_eq!(
            specs.len(),
            3,
            "the two Target Speed effects must not be merged"
        );
        assert_eq!(specs[0].value_scaling, ValueScalingPolicy::Direct);
        assert_eq!(
            specs[1].value_scaling,
            ValueScalingPolicy::MultiplyActivatedTaggedSkillCount
        );
        assert_eq!(
            specs[2].value_scaling,
            ValueScalingPolicy::MultiplyActivatedTaggedSkillCount
        );
        // 5-second base duration preserved (value scaling changes value only).
        assert_eq!(specs[0].base_duration, 5.0);

        // (green count, scaled Target Speed, scaled Acceleration) per tier.
        let tiers = [
            (0usize, 0.0, 0.0),
            (3, 0.05, 0.05),
            (5, 0.10, 0.10),
            (6, 0.15, 0.15),
        ];
        for (count, scaled_ts, scaled_accel) in tiers {
            let direct = resolve_modifier(
                &specs[0],
                &mut EffectResolutionContext::new(None).with_activated_green_count(count),
            )
            .expect("direct resolves");
            assert!(
                (direct - 0.25).abs() < 1e-9,
                "Direct Target Speed stays 0.25 at count {count}, got {direct}"
            );
            let ts = resolve_modifier(
                &specs[1],
                &mut EffectResolutionContext::new(None).with_activated_green_count(count),
            )
            .expect("ts resolves");
            assert!(
                (ts - scaled_ts).abs() < 1e-9,
                "scaled Target Speed count {count}: expected {scaled_ts}, got {ts}"
            );
            let accel = resolve_modifier(
                &specs[2],
                &mut EffectResolutionContext::new(None).with_activated_green_count(count),
            )
            .expect("accel resolves");
            assert!(
                (accel - scaled_accel).abs() < 1e-9,
                "scaled Acceleration count {count}: expected {scaled_accel}, got {accel}"
            );
        }
    }

    #[test]
    fn multiply_activated_tagged_scales_base_modifier_by_tier() {
        // Copano Rickey's scaled Target Speed base is 0.05: 0/0.05/0.10/0.15
        // across the four count tiers.
        let effect = spec(
            SkillType::TargetSpeed,
            0.05,
            ValueScalingPolicy::MultiplyActivatedTaggedSkillCount,
        );
        let cases = [
            (0usize, 0.0),
            (2, 0.0),
            (3, 0.05),
            (4, 0.05),
            (5, 0.10),
            (6, 0.15),
            (8, 0.15),
        ];
        for (count, expected) in cases {
            let mut ctx = EffectResolutionContext::new(None).with_activated_green_count(count);
            let resolved = resolve_modifier(&effect, &mut ctx).expect("resolves");
            assert!(
                (resolved - expected).abs() < 1e-9,
                "count {count}: expected {expected}, got {resolved}"
            );
        }
    }
}
