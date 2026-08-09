//! The [`StaminaPolicy`] strategy trait, the [`RaceStateSlice`] value object it
//! reads, and the [`NoopStaminaPolicy`].
//!
//! Port of `health/health-policy.ts`. The policy is a DDD *strategy object*: the
//! racing `Runner` owns a `Box<dyn StaminaPolicy>` and delegates HP drain,
//! recovery, and last-spurt decisions to it. Methods read a narrow
//! [`RaceStateSlice`] / [`StaminaStats`] view rather than the full `Runner`, so
//! the stamina context stays decoupled from `racing`.

use crate::shared_kernel::language::{Phase, Strategy};
use crate::skills::effect::PositionKeepState;

/// The slice of live runner state the stamina policy needs each tick.
///
/// Mirrors the TypeScript `RaceStateSlice`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RaceStateSlice {
    /// Current race phase.
    pub phase: Phase,
    /// Position-keep state (affects pace-down HP modifier).
    pub position_keep_state: PositionKeepState,
    /// Whether the runner is rushed (temptation).
    pub is_rushed: bool,
    /// Whether the runner is in downhill (HP-saving) mode.
    pub is_downhill_mode: bool,
    /// Whether the runner is in a spot-struggle.
    pub in_spot_struggle: bool,
    /// The position-keep strategy, if any (Runaway gets harsher struggle costs).
    pub pos_keep_strategy: Option<Strategy>,
    /// Current longitudinal position in meters.
    pub pos: f64,
    /// Current speed in m/s.
    pub current_speed: f64,
}

/// The stats the policy reads at [`init`](StaminaPolicy::init) time (post-green
/// adjusted stats).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StaminaStats {
    /// Running style.
    pub strategy: Strategy,
    /// Adjusted stamina.
    pub stamina: f64,
    /// Adjusted guts.
    pub guts: f64,
    /// Adjusted wit (wisdom).
    pub wit: f64,
}

/// The HP-budget strategy object plugged into a runner.
///
/// `init` is called after the first round of skill activations (so adjusted
/// stats are final); `tick` drains HP each step; `get_last_spurt_pair` decides
/// the spurt transition point and speed.
pub trait StaminaPolicy {
    /// Initialise max HP / modifiers from the runner's adjusted stats.
    fn init(&mut self, stats: &StaminaStats);
    /// Drain HP for a `dt`-second step given the current race state.
    fn tick(&mut self, state: &RaceStateSlice, dt: f64);
    /// Whether any HP remains (cheap check).
    fn has_remaining_health(&self) -> bool;
    /// Fraction of max HP remaining, clamped to `[0, 1]`.
    fn health_ratio_remaining(&self) -> f64;
    /// Recover `modifier` fraction of max HP (clamped to max).
    fn recover(&mut self, modifier: f64);
    /// Decide the last-spurt `(transition_position, speed)` pair. A
    /// `transition_position` of `-1` means "spurt the whole last leg".
    fn get_last_spurt_pair(
        &mut self,
        state: &RaceStateSlice,
        max_speed: f64,
        base_target_speed2: f64,
    ) -> (f64, f64);
    /// Whether the runner committed to a full max-speed spurt.
    fn is_max_spurt(&self) -> bool;
    /// Current absolute HP.
    fn current_health(&self) -> f64;
}

/// A no-op policy: infinite HP, never spurts. Mirrors `NoopHpPolicy`.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoopStaminaPolicy;

impl StaminaPolicy for NoopStaminaPolicy {
    fn init(&mut self, _stats: &StaminaStats) {}
    fn tick(&mut self, _state: &RaceStateSlice, _dt: f64) {}
    fn has_remaining_health(&self) -> bool {
        true
    }
    fn health_ratio_remaining(&self) -> f64 {
        1.0
    }
    fn recover(&mut self, _modifier: f64) {}
    fn get_last_spurt_pair(
        &mut self,
        _state: &RaceStateSlice,
        max_speed: f64,
        _base_target_speed2: f64,
    ) -> (f64, f64) {
        (-1.0, max_speed)
    }
    fn is_max_spurt(&self) -> bool {
        false
    }
    fn current_health(&self) -> f64 {
        1.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn noop_policy_has_full_health_and_no_spurt() {
        let mut policy = NoopStaminaPolicy;
        let stats = StaminaStats {
            strategy: Strategy::PaceChaser,
            stamina: 1000.0,
            guts: 400.0,
            wit: 600.0,
        };
        policy.init(&stats);
        let state = RaceStateSlice {
            phase: Phase::LateRace,
            position_keep_state: PositionKeepState::None,
            is_rushed: false,
            is_downhill_mode: false,
            in_spot_struggle: false,
            pos_keep_strategy: None,
            pos: 0.0,
            current_speed: 20.0,
        };
        policy.tick(&state, 1.0);
        assert!(policy.has_remaining_health());
        assert_eq!(policy.health_ratio_remaining(), 1.0);
        assert_eq!(policy.get_last_spurt_pair(&state, 25.0, 20.0), (-1.0, 25.0));
        assert!(!policy.is_max_spurt());
    }
}
