//! The effect taxonomy enums: [`SkillType`], [`SkillRarity`], [`SkillTarget`],
//! [`SkillPerspective`], [`PositionKeepState`].
//!
//! Ported from `skills/definitions.ts`. Discriminants match the game data so the
//! values round-trip through the data boundary. `SkillType` is intentionally
//! sparse (the game numbers effect types non-contiguously).

use serde::{Deserialize, Serialize};

/// The kind of effect a skill applies. Discriminants are the raw game effect
/// type ids (non-contiguous).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(i32)]
pub enum SkillType {
    /// No effect.
    Noop = 0,
    /// Flat speed stat bonus.
    SpeedUp = 1,
    /// Flat stamina stat bonus.
    StaminaUp = 2,
    /// Flat power stat bonus.
    PowerUp = 3,
    /// Flat guts stat bonus.
    GutsUp = 4,
    /// Flat wisdom stat bonus.
    WisdomUp = 5,
    /// Changes the runner's position-keep strategy.
    ChangeStrategy = 6,
    /// Modifies the runner's HP (heal or stamina drain).
    Recovery = 9,
    /// Multiplies the runner's starting delay.
    MultiplyStartDelay = 10,
    /// Sets the runner's starting delay.
    SetStartDelay = 14,
    /// Increases the runner's actual (current) speed.
    CurrentSpeed = 21,
    /// Increases current speed, decaying via natural deceleration.
    CurrentSpeedWithNaturalDeceleration = 22,
    /// Increases the runner's target speed.
    TargetSpeed = 27,
    /// Increases lane-change movement speed.
    LaneMovementSpeed = 28,
    /// Increases acceleration toward top speed.
    Accel = 31,
    /// Triggers when the runner changes lanes.
    ChangeLane = 35,
    /// Activates a random gold skill (Summer Goldship unique).
    ActivateRandomGold = 37,
    /// Adds base duration to an evolved skill.
    ExtendEvolvedDuration = 42,
}

impl SkillType {
    /// Whether this is a "green" stat-up skill (types 1..=5).
    pub fn is_green(self) -> bool {
        matches!(
            self,
            SkillType::SpeedUp
                | SkillType::StaminaUp
                | SkillType::PowerUp
                | SkillType::GutsUp
                | SkillType::WisdomUp
        )
    }

    /// Whether a raw type id falls in the green-skill range (1..=5).
    pub fn is_green_type(type_id: i32) -> bool {
        (1..=5).contains(&type_id)
    }
}

/// Error returned when a raw effect type id has no [`SkillType`] mapping.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UnknownSkillType(pub i32);

impl std::fmt::Display for UnknownSkillType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "unknown skill effect type id {}", self.0)
    }
}

impl std::error::Error for UnknownSkillType {}

impl TryFrom<i32> for SkillType {
    type Error = UnknownSkillType;

    fn try_from(value: i32) -> Result<Self, Self::Error> {
        let ty = match value {
            0 => SkillType::Noop,
            1 => SkillType::SpeedUp,
            2 => SkillType::StaminaUp,
            3 => SkillType::PowerUp,
            4 => SkillType::GutsUp,
            5 => SkillType::WisdomUp,
            6 => SkillType::ChangeStrategy,
            9 => SkillType::Recovery,
            10 => SkillType::MultiplyStartDelay,
            14 => SkillType::SetStartDelay,
            21 => SkillType::CurrentSpeed,
            22 => SkillType::CurrentSpeedWithNaturalDeceleration,
            27 => SkillType::TargetSpeed,
            28 => SkillType::LaneMovementSpeed,
            31 => SkillType::Accel,
            35 => SkillType::ChangeLane,
            37 => SkillType::ActivateRandomGold,
            42 => SkillType::ExtendEvolvedDuration,
            other => return Err(UnknownSkillType(other)),
        };
        Ok(ty)
    }
}

/// Whose perspective an effect is evaluated from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(i32)]
pub enum SkillPerspective {
    /// The runner who owns the skill.
    SelfPerspective = 1,
    /// Another runner.
    Other = 2,
    /// Either.
    Any = 3,
}

/// Skill rarity. Note 1★/2★ uniques, 1★/2★ upgraded-to-3★, and natural 3★
/// uniques all share the `Unique` family in the source data.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(i32)]
pub enum SkillRarity {
    /// Common (white) skill.
    White = 1,
    /// Gold skill.
    Gold = 2,
    /// Unique skill.
    Unique = 3,
    /// Evolution skill.
    Evolution = 6,
}

/// Which runners an effect targets.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(i32)]
pub enum SkillTarget {
    /// The skill owner.
    SelfTarget = 1,
    /// All runners.
    All = 2,
    /// Runners in field of view.
    InFov = 4,
    /// Runners ahead of a position.
    AheadOfPosition = 7,
    /// Runners ahead of the owner.
    AheadOfSelf = 9,
    /// Runners behind the owner.
    BehindSelf = 10,
    /// All allies.
    AllAllies = 11,
    /// Runners of an enemy strategy.
    EnemyStrategy = 18,
    /// Kakari (debuff) targets ahead.
    KakariAhead = 19,
    /// Kakari targets behind.
    KakariBehind = 20,
    /// Kakari targets by strategy.
    KakariStrategy = 21,
    /// A specific Uma id.
    UmaId = 22,
    /// Runners that used a recovery skill.
    UsedRecovery = 23,
}

/// Position-keeping state during the early race.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(i32)]
pub enum PositionKeepState {
    /// Not position keeping.
    None = 0,
    /// Speeding up to keep pace.
    PaceUp = 1,
    /// Slowing down to keep pace.
    PaceDown = 2,
    /// Speeding up.
    SpeedUp = 3,
    /// Overtaking.
    Overtake = 4,
    /// Post-1.5 extended pace-up when an unexpectedly backline strategy is ahead.
    PaceUpEx = 5,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discriminants_match_game_values() {
        assert_eq!(SkillType::Noop as i32, 0);
        assert_eq!(SkillType::ChangeStrategy as i32, 6);
        assert_eq!(SkillType::ExtendEvolvedDuration as i32, 42);
        assert_eq!(SkillRarity::Evolution as i32, 6);
        assert_eq!(SkillTarget::UsedRecovery as i32, 23);
        assert_eq!(SkillPerspective::Any as i32, 3);
        assert_eq!(PositionKeepState::Overtake as i32, 4);
        assert_eq!(PositionKeepState::PaceUpEx as i32, 5);
    }

    #[test]
    fn green_skill_range_is_one_to_five() {
        assert!(SkillType::SpeedUp.is_green());
        assert!(SkillType::WisdomUp.is_green());
        assert!(!SkillType::Recovery.is_green());
        for t in 1..=5 {
            assert!(SkillType::is_green_type(t));
        }
        assert!(!SkillType::is_green_type(0));
        assert!(!SkillType::is_green_type(9));
    }
}
