//! Domain constant tables (speed/accel/ground/strategy/position-keep
//! coefficients) indexed by the ubiquitous-language enums.
//!
//! Ported verbatim from the TypeScript `shared/definitions.ts` (and the
//! per-phase deceleration / base-accel constants from `common/runner.ts`). The
//! numeric values *are* the game's tuning; treat them as ground truth and do not
//! "clean up" the magic numbers.
//!
//! Tables that the source indexes by a 1-based discriminant keep a leading dummy
//! row at index 0 so `strategy as usize` / `surface as usize` index directly.

use crate::shared_kernel::language::{Aptitude, GroundCondition, Phase, Strategy, Surface};

/// Acceleration coefficient tables.
pub mod acceleration {
    use super::{Aptitude, Phase, Strategy};

    /// Strategy × phase acceleration coefficient. Row index is `strategy as
    /// usize` (1..=5); row 0 is an unused dummy. Column index is the phase index
    /// (0..=2); `LastSpurt` reuses the `LateRace` column.
    pub const STRATEGY_PHASE_COEFFICIENT: [[f64; 3]; 6] = [
        [0.0, 0.0, 0.0],
        [1.0, 1.0, 0.996],
        [0.985, 1.0, 0.996],
        [0.975, 1.0, 1.0],
        [0.945, 1.0, 0.997],
        [1.17, 0.94, 0.956],
    ];

    /// Ground-type (surface) aptitude proficiency modifier, indexed by
    /// [`Aptitude`] (S=0..G=7).
    pub const GROUND_TYPE_PROFICIENCY_MODIFIER: [f64; 8] =
        [1.05, 1.0, 0.9, 0.8, 0.7, 0.5, 0.3, 0.1];

    /// Distance aptitude proficiency modifier, indexed by [`Aptitude`].
    pub const DISTANCE_PROFICIENCY_MODIFIER: [f64; 8] = [1.0, 1.0, 1.0, 1.0, 1.0, 0.6, 0.5, 0.4];

    /// Acceleration strategy/phase coefficient for `strategy` in the phase whose
    /// 0..=2 column index is `phase_column`. `LastSpurt` should pass column `2`.
    pub fn strategy_phase_coefficient(strategy: Strategy, phase_column: usize) -> f64 {
        STRATEGY_PHASE_COEFFICIENT[strategy as usize][phase_column]
    }

    /// Ground-type proficiency modifier for an aptitude grade.
    pub fn ground_type_proficiency(aptitude: Aptitude) -> f64 {
        GROUND_TYPE_PROFICIENCY_MODIFIER[aptitude.index()]
    }

    /// Distance proficiency modifier for an aptitude grade.
    pub fn distance_proficiency(aptitude: Aptitude) -> f64 {
        DISTANCE_PROFICIENCY_MODIFIER[aptitude.index()]
    }

    /// Phase column index used by the acceleration tables (clamps `LastSpurt`
    /// onto the `LateRace` column).
    pub fn phase_column(phase: Phase) -> usize {
        match phase {
            Phase::EarlyRace => 0,
            Phase::MidRace => 1,
            Phase::LateRace | Phase::LastSpurt => 2,
        }
    }
}

/// Speed coefficient tables.
pub mod speed {
    use super::{Aptitude, Phase, Strategy};

    /// Strategy × phase speed coefficient. Row index is `strategy as usize`
    /// (1..=5); row 0 is an unused dummy. Column index is the phase index
    /// (0..=2); `LastSpurt` reuses the `LateRace` column.
    pub const STRATEGY_PHASE_COEFFICIENT: [[f64; 3]; 6] = [
        [0.0, 0.0, 0.0],
        [1.0, 0.98, 0.962],
        [0.978, 0.991, 0.975],
        [0.938, 0.998, 0.994],
        [0.931, 1.0, 1.0],
        [1.063, 0.962, 0.95],
    ];

    /// Distance aptitude proficiency modifier, indexed by [`Aptitude`]
    /// (S=0..G=7).
    pub const DISTANCE_PROFICIENCY_MODIFIER: [f64; 8] = [1.05, 1.0, 0.9, 0.8, 0.6, 0.4, 0.2, 0.1];

    /// Speed strategy/phase coefficient for `strategy` in the phase whose 0..=2
    /// column index is `phase_column`. `LastSpurt` should pass column `2`.
    pub fn strategy_phase_coefficient(strategy: Strategy, phase_column: usize) -> f64 {
        STRATEGY_PHASE_COEFFICIENT[strategy as usize][phase_column]
    }

    /// Distance proficiency modifier for an aptitude grade.
    pub fn distance_proficiency(aptitude: Aptitude) -> f64 {
        DISTANCE_PROFICIENCY_MODIFIER[aptitude.index()]
    }

    /// Phase column index used by the speed tables (clamps `LastSpurt` onto the
    /// `LateRace` column).
    pub fn phase_column(phase: Phase) -> usize {
        match phase {
            Phase::EarlyRace => 0,
            Phase::MidRace => 1,
            Phase::LateRace | Phase::LastSpurt => 2,
        }
    }
}

/// Ground (surface × condition) speed penalty. Outer index is `surface as usize`
/// (1=Turf, 2=Dirt; row 0 unused). Inner index is `ground_condition as usize`
/// (1..=4; column 0 unused).
pub const GROUND_SPEED_MODIFIER: [[i32; 5]; 3] =
    [[0, 0, 0, 0, 0], [0, 0, 0, 0, -50], [0, 0, 0, 0, -50]];

/// Ground (surface × condition) power penalty. Same indexing as
/// [`GROUND_SPEED_MODIFIER`].
pub const GROUND_POWER_MODIFIER: [[i32; 5]; 3] = [
    [0, 0, 0, 0, 0],
    [0, 0, -50, -50, -50],
    [0, -100, -50, -100, -100],
];

/// Ground speed modifier for a surface and ground condition.
pub fn ground_speed_modifier(surface: Surface, condition: GroundCondition) -> i32 {
    GROUND_SPEED_MODIFIER[surface as usize][condition.index()]
}

/// Ground power modifier for a surface and ground condition.
pub fn ground_power_modifier(surface: Surface, condition: GroundCondition) -> i32 {
    GROUND_POWER_MODIFIER[surface as usize][condition.index()]
}

/// Strategy-specific tuning constants.
pub mod strategy_module {
    use super::{Aptitude, Strategy};

    /// "Force in" speed modifier indexed by `strategy as usize` (1..=4). Row 0
    /// is unused; `Runaway` (5) has no source entry — see
    /// [`force_in_speed_modifier`].
    pub const FORCE_IN_SPEED_MODIFIER: [f64; 5] = [0.0, 0.02, 0.01, 0.01, 0.03];

    /// Wit aptitude modifier indexed by [`Aptitude`] (S=0..G=7).
    pub const APTITUDE_MODIFIER: [f64; 8] = [1.1, 1.0, 0.85, 0.75, 0.6, 0.4, 0.2, 0.1];

    /// Force-in speed modifier for a strategy.
    ///
    /// The source object only defines Front Runner / Pace Chaser / Late Surger /
    /// End Closer. `Runaway` collapses to its base strategy (Front Runner) here,
    /// rather than reproducing the TypeScript `undefined`/`NaN` lookup.
    pub fn force_in_speed_modifier(strategy: Strategy) -> f64 {
        FORCE_IN_SPEED_MODIFIER[strategy.base_strategy() as usize]
    }

    /// Wit aptitude modifier for an aptitude grade.
    pub fn aptitude_modifier(aptitude: Aptitude) -> f64 {
        APTITUDE_MODIFIER[aptitude.index()]
    }
}

/// Position-keep thresholds.
pub mod position_keep {
    use super::Strategy;

    /// Base minimum position-keep threshold indexed by `strategy as usize`.
    /// `FrontRunner=1`..`EndCloser=4` carry the TS values; `Runaway=5` (TS index
    /// 0) is `0.0`, so the array is length 6 to stay in bounds.
    pub const BASE_MINIMUM_THRESHOLD: [f64; 6] = [0.0, 0.0, 3.0, 6.5, 7.5, 0.0];

    /// Base maximum position-keep threshold indexed by `strategy as usize`
    /// (`Runaway=5` -> `0.0`, matching TS index 0).
    pub const BASE_MAXIMUM_THRESHOLD: [f64; 6] = [0.0, 0.0, 5.0, 7.0, 8.0, 0.0];

    /// Course distance factor applied to most position-keep thresholds.
    pub fn course_factor(distance: f64) -> f64 {
        0.0008 * (distance - 1000.0) + 1.0
    }

    /// Minimum position-keep threshold for a strategy on a given distance.
    ///
    /// Pace Chaser uses a flat factor of `1.0` (its minimum is independent of the
    /// course factor); every other strategy scales by [`course_factor`].
    pub fn min_threshold(strategy: Strategy, distance: f64) -> f64 {
        let factor = if strategy == Strategy::PaceChaser {
            1.0
        } else {
            course_factor(distance)
        };
        BASE_MINIMUM_THRESHOLD[strategy as usize] * factor
    }

    /// Maximum position-keep threshold for a strategy on a given distance.
    pub fn max_threshold(strategy: Strategy, distance: f64) -> f64 {
        BASE_MAXIMUM_THRESHOLD[strategy as usize] * course_factor(distance)
    }
}

/// Per-phase deceleration, indexed by phase 0..=2 (`PhaseDeceleration` in the
/// source). `LastSpurt` has no entry.
pub const PHASE_DECELERATION: [f64; 3] = [-1.2, -0.8, -1.0];

/// Baseline acceleration constant (`BaseAccel`).
pub const BASE_ACCEL: f64 = 0.0006;

/// Baseline uphill acceleration constant (`UphillBaseAccel`).
pub const UPHILL_BASE_ACCEL: f64 = 0.0004;

/// Hard ceiling on target speed (mechanics § Target Speed).
pub const TARGET_SPEED_CAP: f64 = 30.0;

/// Fraction of course width beyond which force-in may apply (mechanics § Target
/// Speed / Force-in).
pub const FORCE_IN_LANE_THRESHOLD_FRACTION: f64 = 0.12;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strategy_phase_coefficients_index_by_discriminant() {
        // Runaway (5) front-phase values.
        assert_eq!(
            speed::strategy_phase_coefficient(Strategy::Runaway, 0),
            1.063
        );
        assert_eq!(
            acceleration::strategy_phase_coefficient(Strategy::Runaway, 1),
            0.94
        );
        // Front Runner mid/late.
        assert_eq!(
            speed::strategy_phase_coefficient(Strategy::FrontRunner, 2),
            0.962
        );
    }

    #[test]
    fn last_spurt_reuses_late_race_column() {
        assert_eq!(speed::phase_column(Phase::LastSpurt), 2);
        assert_eq!(speed::phase_column(Phase::LateRace), 2);
        assert_eq!(acceleration::phase_column(Phase::EarlyRace), 0);
    }

    #[test]
    fn aptitude_modifiers_span_s_to_g() {
        assert_eq!(speed::distance_proficiency(Aptitude::S), 1.05);
        assert_eq!(speed::distance_proficiency(Aptitude::G), 0.1);
        assert_eq!(acceleration::ground_type_proficiency(Aptitude::S), 1.05);
        assert_eq!(strategy_module::aptitude_modifier(Aptitude::A), 1.0);
    }

    #[test]
    fn ground_modifiers_penalize_heavy_and_dirt() {
        assert_eq!(
            ground_speed_modifier(Surface::Turf, GroundCondition::Heavy),
            -50
        );
        assert_eq!(
            ground_speed_modifier(Surface::Turf, GroundCondition::Firm),
            0
        );
        assert_eq!(
            ground_power_modifier(Surface::Dirt, GroundCondition::Good),
            -50
        );
        assert_eq!(
            ground_power_modifier(Surface::Dirt, GroundCondition::Firm),
            -100
        );
    }

    #[test]
    fn force_in_speed_modifier_collapses_runaway() {
        assert_eq!(
            strategy_module::force_in_speed_modifier(Strategy::EndCloser),
            0.03
        );
        assert_eq!(
            strategy_module::force_in_speed_modifier(Strategy::Runaway),
            strategy_module::force_in_speed_modifier(Strategy::FrontRunner)
        );
    }

    #[test]
    fn target_speed_cap_is_thirty() {
        assert_eq!(TARGET_SPEED_CAP, 30.0);
        assert_eq!(FORCE_IN_LANE_THRESHOLD_FRACTION, 0.12);
    }

    #[test]
    fn position_keep_thresholds_scale_with_distance() {
        // Pace Chaser minimum ignores the course factor.
        assert_eq!(
            position_keep::min_threshold(Strategy::PaceChaser, 2400.0),
            3.0
        );
        // End Closer minimum scales by the course factor.
        let factor = position_keep::course_factor(2000.0);
        assert!((factor - 1.8).abs() < 1e-9);
        assert!(
            (position_keep::min_threshold(Strategy::EndCloser, 2000.0) - 7.5 * factor).abs() < 1e-9
        );
        assert!(
            (position_keep::max_threshold(Strategy::LateSurger, 2000.0) - 7.0 * factor).abs()
                < 1e-9
        );
    }

    #[test]
    fn scalar_constants_match_source() {
        assert_eq!(PHASE_DECELERATION, [-1.2, -0.8, -1.0]);
        assert_eq!(BASE_ACCEL, 0.0006);
        assert_eq!(UPHILL_BASE_ACCEL, 0.0004);
    }
}
