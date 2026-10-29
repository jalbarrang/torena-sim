//! Skill-level value scaling (mechanics § Skill Level).
//!
//! A leveled skill multiplies each effect's value by a per-level factor that
//! depends on the effect type. The engine receives the level with the skill
//! (default 1, which is the unscaled row) and folds the multiplier into the
//! effect's base modifier when the effect is built, so value-usage resolution
//! and every downstream consumer see an already-leveled base value.

use crate::skills::effect::SkillType;

/// Highest level the mechanics table defines.
pub const MAX_SKILL_LEVEL: u8 = 10;

/// Table rows for levels 1..=10, indexed by `level - 1`.
const TARGET_SPEED: [f64; 10] = [1.0, 1.01, 1.04, 1.07, 1.10, 1.13, 1.16, 1.19, 1.22, 1.25];
const ACCEL: [f64; 10] = [1.0, 1.02, 1.04, 1.06, 1.08, 1.10, 1.125, 1.15, 1.175, 1.20];
const STAT: [f64; 10] = [1.0, 1.01, 1.02, 1.03, 1.04, 1.05, 1.06, 1.07, 1.08, 1.10];
const OTHER: [f64; 10] = [1.0, 1.02, 1.04, 1.06, 1.08, 1.10, 1.12, 1.14, 1.16, 1.18];

/// The value multiplier for `effect_type` at `level`.
///
/// Recovery, current-speed, and lane-movement effects do not scale with level.
/// Level 1 and any level outside `1..=MAX_SKILL_LEVEL` return `1.0`; the DTO
/// boundary rejects out-of-range levels, so the clamp here is defense in depth.
#[must_use]
pub fn level_multiplier(effect_type: SkillType, level: u8) -> f64 {
    if !(1..=MAX_SKILL_LEVEL).contains(&level) {
        return 1.0;
    }
    let row = usize::from(level - 1);
    match effect_type {
        SkillType::TargetSpeed => TARGET_SPEED[row],
        SkillType::Accel => ACCEL[row],
        SkillType::SpeedUp
        | SkillType::StaminaUp
        | SkillType::PowerUp
        | SkillType::GutsUp
        | SkillType::WisdomUp => STAT[row],
        SkillType::Recovery
        | SkillType::CurrentSpeed
        | SkillType::CurrentSpeedWithNaturalDeceleration
        | SkillType::LaneMovementSpeed => 1.0,
        _ => OTHER[row],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn follows_the_mechanics_table() {
        assert_eq!(level_multiplier(SkillType::TargetSpeed, 6), 1.13);
        assert_eq!(level_multiplier(SkillType::TargetSpeed, 10), 1.25);
        assert_eq!(level_multiplier(SkillType::Accel, 10), 1.20);
        assert_eq!(level_multiplier(SkillType::SpeedUp, 10), 1.10);
        assert_eq!(level_multiplier(SkillType::MultiplyStartDelay, 10), 1.18);
    }

    #[test]
    fn level_one_is_unscaled_for_every_type() {
        for ty in [
            SkillType::TargetSpeed,
            SkillType::Accel,
            SkillType::GutsUp,
            SkillType::Noop,
        ] {
            assert_eq!(level_multiplier(ty, 1), 1.0);
        }
    }

    #[test]
    fn excluded_types_never_scale() {
        for ty in [
            SkillType::Recovery,
            SkillType::CurrentSpeed,
            SkillType::CurrentSpeedWithNaturalDeceleration,
            SkillType::LaneMovementSpeed,
        ] {
            assert_eq!(level_multiplier(ty, 6), 1.0);
        }
    }

    #[test]
    fn out_of_range_levels_are_unscaled() {
        assert_eq!(level_multiplier(SkillType::TargetSpeed, 0), 1.0);
        assert_eq!(level_multiplier(SkillType::TargetSpeed, 11), 1.0);
    }
}
