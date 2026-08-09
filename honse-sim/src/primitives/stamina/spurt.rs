//! Spurt-calculation **domain service**: base/early speeds, HP-per-second,
//! required HP, spurt distance, and the optimal-spurt search.
//!
//! Port of `common/spurt-calculator.ts` (itself ported from umasim's
//! `RaceCalculator.kt`). These are pure functions over scalars — no runner or
//! race state — so they can be reused by the policy and by analysis tooling.

use crate::shared_kernel::language::{GroundCondition, Surface};

/// HP strategy coefficient indexed by strategy discriminant (`[_, nige, senko,
/// sashi, oikomi, oonige]`).
pub const HP_STRATEGY_COEFFICIENT: [f64; 6] = [0.0, 0.95, 0.89, 1.0, 0.995, 0.86];

/// A candidate last-spurt plan produced by [`find_optimal_spurt`].
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SpurtCandidate {
    /// Position where the spurt begins.
    pub transition_position: f64,
    /// Spurt speed.
    pub speed: f64,
    /// Distance covered by the spurt.
    pub distance: f64,
    /// Total time to complete the race under this plan.
    pub time: f64,
    /// HP remaining after the race.
    pub hp_diff: f64,
}

/// Course base speed: `20 - (distance - 2000) / 1000`.
pub fn calculate_base_speed(distance: f64) -> f64 {
    20.0 - (distance - 2000.0) / 1000.0
}

/// Estimated average speed during the early-race start dash (used for
/// time-based skill-condition distance estimates).
pub fn calculate_early_race_average_speed(distance: f64) -> f64 {
    let base_speed = calculate_base_speed(distance);
    let start_speed = 3.0;
    let start_dash_threshold = 0.85 * base_speed;
    (start_speed + start_dash_threshold) / 2.0
}

/// HP consumption coefficient for a surface + ground condition.
pub fn get_ground_consumption_coef(surface: Surface, condition: GroundCondition) -> f64 {
    const COEFFICIENTS: [[f64; 5]; 3] = [
        [0.0, 0.0, 0.0, 0.0, 0.0],
        [0.0, 1.0, 1.0, 1.02, 1.02], // Turf
        [0.0, 1.0, 1.0, 1.01, 1.02], // Dirt
    ];
    COEFFICIENTS
        .get(surface as usize)
        .and_then(|row| row.get(condition as usize))
        .copied()
        .unwrap_or(1.0)
}

/// HP consumed per second at `velocity`. In phase 2+ the guts modifier applies.
pub fn calculate_hp_per_second(
    velocity: f64,
    base_speed: f64,
    ground_coef: f64,
    guts_modifier: f64,
    status_modifier: f64,
    in_spurt_phase: bool,
) -> f64 {
    let guts = if in_spurt_phase { guts_modifier } else { 1.0 };
    (20.0 * (velocity - base_speed + 12.0).powi(2) / 144.0) * status_modifier * ground_coef * guts
}

/// HP required to cover `distance` at `velocity`.
pub fn calculate_required_hp(
    velocity: f64,
    distance: f64,
    base_speed: f64,
    ground_coef: f64,
    guts_modifier: f64,
    in_spurt_phase: bool,
) -> f64 {
    let time = distance / velocity;
    let hp_per_sec = calculate_hp_per_second(
        velocity,
        base_speed,
        ground_coef,
        guts_modifier,
        1.0,
        in_spurt_phase,
    );
    hp_per_sec * time
}

/// Maximum distance the runner can spurt at `target_speed` before dropping to
/// `base_speed` to reach the finish.
#[allow(
    clippy::too_many_arguments,
    reason = "mirrors the TS spurt formula's parameter list 1:1; bundling into a \
               struct would obscure the parity mapping to the reference engine"
)]
pub fn calculate_spurt_distance(
    current_hp: f64,
    current_position: f64,
    course_distance: f64,
    target_speed: f64,
    base_speed: f64,
    base_speed_course: f64,
    ground_coef: f64,
    guts_modifier: f64,
) -> f64 {
    const BUFFER_DISTANCE: f64 = 60.0;
    let remaining_distance = course_distance - current_position;
    let distance_at_base = remaining_distance - BUFFER_DISTANCE;
    let hp_for_base = calculate_required_hp(
        base_speed,
        distance_at_base,
        base_speed_course,
        ground_coef,
        guts_modifier,
        true,
    );

    let excess_hp = current_hp - hp_for_base;
    if excess_hp <= 0.0 {
        return 0.0;
    }

    let consumption_at_target = calculate_hp_per_second(
        target_speed,
        base_speed_course,
        ground_coef,
        guts_modifier,
        1.0,
        true,
    );
    let consumption_at_base = calculate_hp_per_second(
        base_speed,
        base_speed_course,
        ground_coef,
        guts_modifier,
        1.0,
        true,
    );
    let consumption_diff = consumption_at_target / target_speed - consumption_at_base / base_speed;

    if consumption_diff <= 0.0 {
        return remaining_distance;
    }

    let spurt_distance = excess_hp / consumption_diff + BUFFER_DISTANCE;
    spurt_distance.min(remaining_distance)
}

/// Find candidate spurt plans, sorted by completion time (fastest first). The
/// game picks from this list via wisdom-based random selection.
#[allow(
    clippy::too_many_arguments,
    reason = "mirrors the TS spurt formula's parameter list 1:1; bundling into a \
               struct would obscure the parity mapping to the reference engine"
)]
pub fn find_optimal_spurt(
    current_hp: f64,
    current_position: f64,
    course_distance: f64,
    base_speed: f64,
    max_speed: f64,
    base_speed_course: f64,
    ground_coef: f64,
    guts_modifier: f64,
    speed_increment: f64,
) -> Vec<SpurtCandidate> {
    let remaining_distance = course_distance - current_position;
    let max_hp_required = calculate_required_hp(
        max_speed,
        remaining_distance - 60.0,
        base_speed_course,
        ground_coef,
        guts_modifier,
        true,
    );

    let max_spurt_dist = calculate_spurt_distance(
        current_hp,
        current_position,
        course_distance,
        max_speed,
        base_speed,
        base_speed_course,
        ground_coef,
        guts_modifier,
    );

    if max_spurt_dist >= remaining_distance {
        return vec![SpurtCandidate {
            transition_position: current_position,
            speed: max_speed,
            distance: remaining_distance,
            time: remaining_distance / max_speed,
            hp_diff: current_hp - max_hp_required,
        }];
    }

    let base_hp_required = calculate_required_hp(
        base_speed,
        remaining_distance - 60.0,
        base_speed_course,
        ground_coef,
        guts_modifier,
        true,
    );

    if current_hp < base_hp_required {
        return vec![SpurtCandidate {
            transition_position: current_position,
            speed: base_speed,
            distance: 0.0,
            time: remaining_distance / base_speed,
            hp_diff: current_hp - max_hp_required,
        }];
    }

    let mut candidates: Vec<SpurtCandidate> = Vec::new();
    let mut speed = base_speed;
    while speed <= max_speed {
        let spurt_dist = calculate_spurt_distance(
            current_hp,
            current_position,
            course_distance,
            speed,
            base_speed,
            base_speed_course,
            ground_coef,
            guts_modifier,
        );
        let time_at_speed = spurt_dist / speed;
        let time_at_base = (remaining_distance - spurt_dist) / base_speed;
        candidates.push(SpurtCandidate {
            transition_position: course_distance - spurt_dist,
            speed,
            distance: spurt_dist,
            time: time_at_speed + time_at_base,
            hp_diff: current_hp - max_hp_required,
        });
        speed += speed_increment;
    }

    candidates.sort_by(|a, b| {
        a.time
            .partial_cmp(&b.time)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    candidates
}

/// HP required for the remainder of the race split across phase 2 and phase 3.
#[allow(
    clippy::too_many_arguments,
    reason = "mirrors the TS spurt formula's parameter list 1:1; bundling into a \
               struct would obscure the parity mapping to the reference engine"
)]
pub fn calculate_required_hp_in_phase2(
    current_position: f64,
    course_distance: f64,
    phase2_speed: f64,
    max_spurt_speed: f64,
    base_speed_course: f64,
    ground_coef: f64,
    guts_modifier: f64,
) -> f64 {
    let phase2_length = (course_distance * 2.0) / 3.0 - current_position;
    let phase3_length = course_distance / 3.0;

    let hp_phase2 = calculate_required_hp(
        phase2_speed,
        phase2_length,
        base_speed_course,
        ground_coef,
        guts_modifier,
        false,
    );
    let hp_phase3 = calculate_required_hp(
        max_spurt_speed,
        phase3_length,
        base_speed_course,
        ground_coef,
        guts_modifier,
        true,
    );

    hp_phase2 + hp_phase3
}

/// Equivalent stamina bonus from an HP-recovery skill (heal in basis points).
pub fn calculate_equivalent_stamina(heal_amount: f64, max_hp: f64, strategy: usize) -> f64 {
    let coef = HP_STRATEGY_COEFFICIENT
        .get(strategy)
        .copied()
        .unwrap_or(1.0);
    let actual_heal = (heal_amount / 10000.0) * max_hp;
    actual_heal / (0.8 * coef)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_speed_matches_formula() {
        assert_eq!(calculate_base_speed(2000.0), 20.0);
        assert_eq!(calculate_base_speed(2400.0), 19.6);
        assert_eq!(calculate_base_speed(1600.0), 20.4);
    }

    #[test]
    fn early_race_average_speed_is_midpoint() {
        // base 20 -> threshold 17, average (3+17)/2 = 10
        assert_eq!(calculate_early_race_average_speed(2000.0), 10.0);
    }

    #[test]
    fn ground_coef_lookup() {
        assert_eq!(
            get_ground_consumption_coef(Surface::Turf, GroundCondition::Firm),
            1.0
        );
        assert_eq!(
            get_ground_consumption_coef(Surface::Turf, GroundCondition::Heavy),
            1.02
        );
        assert_eq!(
            get_ground_consumption_coef(Surface::Dirt, GroundCondition::Soft),
            1.01
        );
    }

    #[test]
    fn hp_per_second_applies_guts_only_in_spurt() {
        let base = calculate_base_speed(2000.0);
        let no_guts = calculate_hp_per_second(20.0, base, 1.0, 1.5, 1.0, false);
        let with_guts = calculate_hp_per_second(20.0, base, 1.0, 1.5, 1.0, true);
        assert!((with_guts - no_guts * 1.5).abs() < 1e-9);
    }

    #[test]
    fn spurt_distance_zero_when_no_excess_hp() {
        // With almost no HP, no spurt distance is available.
        let dist = calculate_spurt_distance(0.0, 1600.0, 2400.0, 22.0, 20.0, 19.6, 1.0, 1.2);
        assert_eq!(dist, 0.0);
    }

    #[test]
    fn find_optimal_spurt_full_max_when_hp_plentiful() {
        let candidates = find_optimal_spurt(1.0e9, 1600.0, 2400.0, 20.0, 25.0, 19.6, 1.0, 1.2, 0.1);
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].speed, 25.0);
        assert_eq!(candidates[0].distance, 800.0);
    }

    #[test]
    fn find_optimal_spurt_sorts_by_time() {
        // HP between the base requirement and a full max spurt -> a spread of
        // candidate speeds is generated.
        let candidates =
            find_optimal_spurt(1200.0, 1600.0, 2400.0, 20.0, 25.0, 19.6, 1.0, 1.2, 0.5);
        assert!(candidates.len() > 1);
        for pair in candidates.windows(2) {
            assert!(pair[0].time <= pair[1].time);
        }
    }
}
