//! External-debuff classification.
//!
//! Ports `skills/external-debuffs.ts`. An *external debuff* is a negative effect
//! that targets someone other than the caster, restricted to the effect types
//! that can meaningfully be injected onto another runner.

use crate::skills::effect::{SkillTarget, SkillType};
use crate::skills::model::{RawSkillEffect, ResolvedSkillEffect, Skill, SkillEffectSpec};

const SELF_TARGET_ID: i32 = SkillTarget::SelfTarget as i32;

/// Effect type ids that qualify as external debuffs.
const EXTERNAL_DEBUFF_EFFECT_TYPES: [i32; 7] = [
    SkillType::Recovery as i32,
    SkillType::CurrentSpeed as i32,
    SkillType::CurrentSpeedWithNaturalDeceleration as i32,
    SkillType::TargetSpeed as i32,
    SkillType::Accel as i32,
    SkillType::LaneMovementSpeed as i32,
    SkillType::ChangeLane as i32,
];

/// Minimal view of an effect needed to classify external debuffs.
pub trait DebuffEffectLike {
    /// Raw effect type id.
    fn effect_type_id(&self) -> i32;
    /// Raw target id.
    fn target_id(&self) -> i32;
    /// Effect modifier (real units).
    fn modifier(&self) -> f64;
}

impl DebuffEffectLike for SkillEffectSpec {
    fn effect_type_id(&self) -> i32 {
        self.effect_type as i32
    }
    fn target_id(&self) -> i32 {
        self.target as i32
    }
    fn modifier(&self) -> f64 {
        self.modifier
    }
}

impl DebuffEffectLike for RawSkillEffect {
    fn effect_type_id(&self) -> i32 {
        self.effect_type
    }
    fn target_id(&self) -> i32 {
        self.target as i32
    }
    fn modifier(&self) -> f64 {
        self.modifier
    }
}

impl DebuffEffectLike for ResolvedSkillEffect {
    fn effect_type_id(&self) -> i32 {
        self.effect_type as i32
    }
    fn target_id(&self) -> i32 {
        self.target as i32
    }
    fn modifier(&self) -> f64 {
        self.modifier
    }
}

/// Whether `effect` is an external debuff: targets someone other than the
/// caster, has a debuff-eligible type, and applies a negative modifier.
pub fn is_external_debuff_effect<E: DebuffEffectLike>(effect: &E) -> bool {
    if effect.target_id() == SELF_TARGET_ID {
        return false;
    }
    if !EXTERNAL_DEBUFF_EFFECT_TYPES.contains(&effect.effect_type_id()) {
        return false;
    }
    effect.modifier() < 0.0
}

/// Return references to the effects in `effects` that are external debuffs.
pub fn get_external_debuff_effects<E: DebuffEffectLike>(effects: &[E]) -> Vec<&E> {
    effects
        .iter()
        .filter(|e| is_external_debuff_effect(*e))
        .collect()
}

/// Whether `skill` has any alternative carrying an external-debuff effect.
pub fn is_injectable_external_debuff_skill(skill: &Skill) -> bool {
    skill
        .alternatives
        .iter()
        .any(|alt| alt.effects.iter().any(is_external_debuff_effect))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared_kernel::ids::SkillId;
    use crate::skills::effect::SkillRarity;
    use crate::skills::model::SkillAlternative;

    fn raw(effect_type: i32, target: SkillTarget, modifier: f64) -> RawSkillEffect {
        RawSkillEffect {
            modifier,
            target,
            effect_type,
            value_usage: None,
            value_level_usage: None,
        }
    }

    #[test]
    fn classifies_external_debuffs() {
        // Negative target-speed on another runner: debuff.
        assert!(is_external_debuff_effect(&raw(27, SkillTarget::All, -0.05)));
        // Self target is never a debuff.
        assert!(!is_external_debuff_effect(&raw(
            27,
            SkillTarget::SelfTarget,
            -0.05
        )));
        // Positive modifier is not a debuff.
        assert!(!is_external_debuff_effect(&raw(27, SkillTarget::All, 0.05)));
        // Ineligible effect type.
        assert!(!is_external_debuff_effect(&raw(1, SkillTarget::All, -0.05)));
    }

    #[test]
    fn filters_debuff_effects() {
        let effects = vec![
            raw(27, SkillTarget::All, -0.05),
            raw(27, SkillTarget::SelfTarget, -0.05),
            raw(9, SkillTarget::EnemyStrategy, -1.0),
        ];
        let debuffs = get_external_debuff_effects(&effects);
        assert_eq!(debuffs.len(), 2);
    }

    #[test]
    fn detects_injectable_skill() {
        let mk = |effects: Vec<RawSkillEffect>| Skill {
            skill_id: SkillId::new("x"),
            rarity: SkillRarity::Gold,
            tags: vec![],
            alternatives: vec![SkillAlternative {
                base_duration: 0.0,
                cooldown_time: None,
                condition: String::new(),
                precondition: None,
                effects,
            }],
        };
        assert!(is_injectable_external_debuff_skill(&mk(vec![raw(
            21,
            SkillTarget::AheadOfSelf,
            -0.1
        )])));
        assert!(!is_injectable_external_debuff_skill(&mk(vec![raw(
            21,
            SkillTarget::SelfTarget,
            -0.1
        )])));
    }
}
