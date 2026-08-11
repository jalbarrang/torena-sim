//! Pre-race readouts: closed-form values that describe a build before it runs.
//!
//! Every value here is already used inside the engines; this module is where
//! they live so a caller that only wants the number does not re-derive it. The
//! engines call these functions too, so a planner and a simulation can never
//! disagree about what a stat is worth.
//!
//! These are closed forms over stats and course length. Anything that depends
//! on how the race actually unfolds — HP actually consumed, finishing order —
//! needs the simulation, not this module.

use crate::shared_kernel::language::Strategy;
use crate::stamina::spurt::HP_STRATEGY_COEFFICIENT;

/// The floor the wisdom check never drops below, as a percentage.
const MIN_ACTIVATION_PERCENT: f64 = 20.0;
/// Numerator of the wisdom check's diminishing term.
const ACTIVATION_NUMERATOR: f64 = 9000.0;

/// Stamina's conversion coefficient for `strategy`.
///
/// Late Surger converts stamina to HP most efficiently (1.0) and Runaway least
/// (0.86).
///
/// ```
/// use honse_sim::readouts::hp_strategy_coefficient;
/// use honse_sim::shared_kernel::language::Strategy;
///
/// assert_eq!(hp_strategy_coefficient(Strategy::LateSurger), 1.0);
/// assert_eq!(hp_strategy_coefficient(Strategy::PaceChaser), 0.89);
/// ```
#[must_use]
pub fn hp_strategy_coefficient(strategy: Strategy) -> f64 {
    HP_STRATEGY_COEFFICIENT
        .get(strategy as usize)
        .copied()
        .unwrap_or(1.0)
}

/// The HP a runner starts the race with.
///
/// `MaxHP = 0.8 * StrategyCoefficient * Stamina + Distance`
///
/// Distance enters directly, so the same stamina is worth proportionally less
/// on a longer course.
///
/// ```
/// use honse_sim::readouts::max_hp;
/// use honse_sim::shared_kernel::language::Strategy;
///
/// // 1200 stamina, Late Surger (1.0), 2000m
/// assert_eq!(max_hp(1200.0, Strategy::LateSurger, 2000.0), 2960.0);
/// ```
#[must_use]
pub fn max_hp(stamina: f64, strategy: Strategy, distance: f64) -> f64 {
    0.8 * hp_strategy_coefficient(strategy) * stamina + distance
}

/// The multiplier applied to HP consumption in the late race and last spurt.
///
/// `1 + 200 / sqrt(600 * Guts)`
///
/// Higher guts means a smaller multiplier, with sharply diminishing returns:
/// 200 guts burns 1.577x, 400 burns 1.408x, 600 burns 1.333x. Non-positive guts
/// has no meaningful multiplier and returns infinity rather than dividing by
/// zero silently.
///
/// ```
/// use honse_sim::readouts::guts_hp_burn_multiplier;
///
/// assert!((guts_hp_burn_multiplier(200.0) - 1.577).abs() < 0.001);
/// assert!((guts_hp_burn_multiplier(600.0) - 1.333).abs() < 0.001);
/// ```
#[must_use]
pub fn guts_hp_burn_multiplier(guts: f64) -> f64 {
    if guts <= 0.0 {
        return f64::INFINITY;
    }
    1.0 + 200.0 / (600.0 * guts).sqrt()
}

/// The chance a skill passes its pre-race wisdom check, as a percentage.
///
/// `max(100 - 9000 / Wit, 20)`
///
/// This reads *base* wit, so strategy proficiency and in-race skill effects do
/// not move it. Unique skills and several effect types skip the check entirely.
///
/// ```
/// use honse_sim::readouts::skill_activation_percent;
///
/// assert_eq!(skill_activation_percent(300.0), 70.0);
/// assert_eq!(skill_activation_percent(600.0), 85.0);
/// // The floor holds for very low wit.
/// assert_eq!(skill_activation_percent(50.0), 20.0);
/// ```
#[must_use]
pub fn skill_activation_percent(base_wit: f64) -> f64 {
    if base_wit <= 0.0 {
        return MIN_ACTIVATION_PERCENT;
    }
    (100.0 - ACTIVATION_NUMERATOR / base_wit).max(MIN_ACTIVATION_PERCENT)
}

/// [`skill_activation_percent`] as a 0.0–1.0 probability, which is the form the
/// engine's roll compares against.
#[must_use]
pub fn skill_activation_chance(base_wit: f64) -> f64 {
    skill_activation_percent(base_wit) * 0.01
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strategy_coefficients_match_the_documented_table() {
        assert_eq!(hp_strategy_coefficient(Strategy::FrontRunner), 0.95);
        assert_eq!(hp_strategy_coefficient(Strategy::PaceChaser), 0.89);
        assert_eq!(hp_strategy_coefficient(Strategy::LateSurger), 1.0);
        assert_eq!(hp_strategy_coefficient(Strategy::EndCloser), 0.995);
        assert_eq!(hp_strategy_coefficient(Strategy::Runaway), 0.86);
    }

    #[test]
    fn max_hp_scales_with_stamina_and_adds_distance() {
        // A runner with no stamina still carries the course length as HP.
        assert_eq!(max_hp(0.0, Strategy::LateSurger, 2400.0), 2400.0);
        // 0.8 * 0.89 * 1000 = 712, plus 1600m.
        assert_eq!(max_hp(1000.0, Strategy::PaceChaser, 1600.0), 2312.0);
    }

    #[test]
    fn guts_burn_matches_the_documented_examples() {
        for (guts, expected) in [(200.0, 1.577), (400.0, 1.408), (600.0, 1.333)] {
            assert!((guts_hp_burn_multiplier(guts) - expected).abs() < 0.001);
        }
    }

    #[test]
    fn guts_burn_falls_as_guts_rises() {
        assert!(guts_hp_burn_multiplier(600.0) < guts_hp_burn_multiplier(200.0));
        assert!(guts_hp_burn_multiplier(0.0).is_infinite());
    }

    #[test]
    fn activation_matches_the_documented_examples() {
        for (wit, expected) in [(300.0, 70.0), (600.0, 85.0), (900.0, 90.0), (1200.0, 92.5)] {
            assert!((skill_activation_percent(wit) - expected).abs() < 1e-9);
        }
    }

    #[test]
    fn activation_holds_its_floor() {
        assert_eq!(skill_activation_percent(100.0), MIN_ACTIVATION_PERCENT);
        assert_eq!(skill_activation_percent(0.0), MIN_ACTIVATION_PERCENT);
        assert_eq!(skill_activation_percent(-1.0), MIN_ACTIVATION_PERCENT);
    }

    #[test]
    fn chance_is_the_percent_over_one_hundred() {
        assert!((skill_activation_chance(600.0) - 0.85).abs() < 1e-9);
    }
}
