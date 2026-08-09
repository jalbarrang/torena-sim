//! Recovery-effect resolution.
//!
//! Ports `skills/recovery-effect-utils.ts`. Recovery is where a negative-modifier
//! *drain* can be clamped by a per-skill override, and where the only current
//! [`crate::skills::value_scaling::ValueScalingPolicy::MultiplyRandom`] effects live (`valueUsage` 8 and 9).
//! The random roll itself is owned by
//! [`crate::skills::value_scaling::resolve_modifier`]; this module only layers
//! the Recovery-specific drain override on top of it. The override is orthogonal
//! to the policy: a finite override clamps a negative Recovery *before* any roll
//! and therefore consumes no random draw.

use crate::shared_kernel::rng::Prng;
use crate::skills::effect::SkillType;
use crate::skills::model::SkillEffectSpec;
use crate::skills::value_scaling::{resolve_modifier, EffectResolutionContext, ResolveError};

/// Resolve one effect's runtime modifier, layering the Recovery-specific drain
/// override on top of the shared value-scaling policy.
///
/// - A negative Recovery modifier with a finite `override_value` clamps to
///   `-[0,1]` *without rolling* (drain override precedence, consumes no RNG).
/// - Every other effect (including non-Recovery) is resolved through the shared
///   [`resolve_modifier`] policy so caster-context and random policies apply
///   uniformly.
pub fn resolve_effect_modifier(
    effect: &SkillEffectSpec,
    skill_rng: Option<&mut dyn Prng>,
    override_value: Option<f64>,
    activated_green_count: usize,
) -> Result<f64, ResolveError> {
    if effect.effect_type == SkillType::Recovery && effect.modifier < 0.0 {
        if let Some(value) = override_value {
            if value.is_finite() {
                return Ok(-value.clamp(0.0, 1.0));
            }
        }
    }

    let mut context =
        EffectResolutionContext::new(skill_rng).with_activated_green_count(activated_green_count);
    resolve_modifier(effect, &mut context)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared_kernel::rng::Prng;
    use crate::skills::effect::SkillTarget;
    use crate::skills::value_scaling::ValueScalingPolicy;

    fn recovery_effect(modifier: f64, value_scaling: ValueScalingPolicy) -> SkillEffectSpec {
        SkillEffectSpec {
            target: SkillTarget::SelfTarget,
            effect_type: SkillType::Recovery,
            base_duration: 0.0,
            modifier,
            value_scaling,
            value_level_usage: None,
        }
    }

    /// RNG stub that returns a fixed `random()` value.
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

    #[test]
    fn non_recovery_direct_passes_through() {
        let mut effect = recovery_effect(0.5, ValueScalingPolicy::Direct);
        effect.effect_type = SkillType::TargetSpeed;
        assert_eq!(resolve_effect_modifier(&effect, None, None, 0), Ok(0.5));
    }

    #[test]
    fn override_clamps_negative_modifier() {
        let effect = recovery_effect(-1.0, ValueScalingPolicy::MultiplyRandom);
        assert_eq!(
            resolve_effect_modifier(&effect, None, Some(0.3), 0),
            Ok(-0.3)
        );
        assert_eq!(
            resolve_effect_modifier(&effect, None, Some(5.0), 0),
            Ok(-1.0)
        );
        assert_eq!(
            resolve_effect_modifier(&effect, None, Some(-2.0), 0),
            Ok(0.0)
        );
    }

    #[test]
    fn direct_recovery_passes_through_without_rolling() {
        let effect = recovery_effect(0.4, ValueScalingPolicy::Direct);
        assert_eq!(resolve_effect_modifier(&effect, None, None, 0), Ok(0.4));
    }

    #[test]
    fn multiply_random_roll_buckets() {
        let effect = recovery_effect(1.0, ValueScalingPolicy::MultiplyRandom);
        let mut nothing = FixedRng(0.5);
        let mut low = FixedRng(0.7);
        let mut high = FixedRng(0.95);
        assert_eq!(
            resolve_effect_modifier(&effect, Some(&mut nothing), None, 0),
            Ok(0.0)
        );
        assert_eq!(
            resolve_effect_modifier(&effect, Some(&mut low), None, 0),
            Ok(0.02)
        );
        assert_eq!(
            resolve_effect_modifier(&effect, Some(&mut high), None, 0),
            Ok(0.04)
        );
    }

    #[test]
    fn missing_rng_errors_for_multiply_random_effect() {
        let effect = recovery_effect(1.0, ValueScalingPolicy::MultiplyRandom);
        assert_eq!(
            resolve_effect_modifier(&effect, None, None, 0),
            Err(ResolveError::MissingSkillRng)
        );
    }
}
