//! Runner stat derivation: raw input stats → mood-adjusted **base stats** →
//! course/ground/strategy-adjusted **effective stats**.
//!
//! Port of `buildBaseStats` / `buildAdjustedStats` (and their helpers
//! `adjustOvercap`, `calculateMoodCoefficient`, `calculateSpeedModifier`) from
//! `common/runner.ts`. Base/adjusted stats are floating-point (the mood and
//! course coefficients are fractional), so they use [`RunnerStats`] rather than
//! the integer input [`StatLine`].

use crate::course::coefficients::{ground_power_modifier, ground_speed_modifier, strategy_module};
use crate::course::model::CourseData;
use crate::shared_kernel::language::{Aptitude, GroundCondition, Mood, ThresholdStat};
use crate::shared_kernel::params::StatLine;

/// A runner's five core stats as floating-point values (post mood / course
/// adjustment).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RunnerStats {
    /// Speed stat.
    pub speed: f64,
    /// Stamina stat.
    pub stamina: f64,
    /// Power stat.
    pub power: f64,
    /// Guts stat.
    pub guts: f64,
    /// Wit (wisdom) stat.
    pub wit: f64,
}

/// Diminishing returns above 1200: each point over 1200 counts as half.
fn adjust_overcap(stat: f64) -> f64 {
    if stat > 1200.0 {
        1200.0 + ((stat - 1200.0) / 2.0).floor()
    } else {
        stat
    }
}

/// The mood (motivation) coefficient: `1 + 0.02 * mood`.
pub fn mood_coefficient(mood: Mood) -> f64 {
    1.0 + 0.02 * f64::from(mood.value())
}

/// Build the mood-adjusted base stats from raw input stats.
pub fn build_base_stats(stats: &StatLine, mood: Mood) -> RunnerStats {
    let coef = mood_coefficient(mood);
    RunnerStats {
        speed: adjust_overcap(f64::from(stats.speed)) * coef,
        stamina: adjust_overcap(f64::from(stats.stamina)) * coef,
        power: adjust_overcap(f64::from(stats.power)) * coef,
        guts: adjust_overcap(f64::from(stats.guts)) * coef,
        wit: adjust_overcap(f64::from(stats.wit)) * coef,
    }
}

/// The course "set status" speed multiplier: each bonus stat contributes
/// `(1 + floor(min(stat, 901) / 300.01)) * 0.05`, averaged over the bonus list.
fn speed_modifier(course: &CourseData, stats: &RunnerStats) -> f64 {
    let stat_value = |stat: ThresholdStat| -> f64 {
        let raw = match stat {
            ThresholdStat::Speed => stats.speed,
            ThresholdStat::Stamina => stats.stamina,
            ThresholdStat::Power => stats.power,
            ThresholdStat::Guts => stats.guts,
            ThresholdStat::Wit => stats.wit,
        };
        raw.min(901.0)
    };

    let bonus_list = &course.course_set_status;
    let divisor = bonus_list.len().max(1) as f64;
    let sum: f64 = bonus_list
        .iter()
        .map(|&stat| (1.0 + (stat_value(stat) / 300.01).floor()) * 0.05)
        .sum();
    1.0 + sum / divisor
}

/// Build the course/ground/strategy-adjusted effective stats from base stats.
pub fn build_adjusted_stats(
    base: &RunnerStats,
    course: &CourseData,
    ground: GroundCondition,
    strategy_aptitude: Aptitude,
) -> RunnerStats {
    let speed_mod = speed_modifier(course, base);
    let ground_speed = f64::from(ground_speed_modifier(course.surface, ground));
    let ground_power = f64::from(ground_power_modifier(course.surface, ground));
    let aptitude_mod = strategy_module::aptitude_modifier(strategy_aptitude);

    RunnerStats {
        speed: (base.speed * speed_mod + ground_speed).max(1.0),
        stamina: base.stamina,
        power: (base.power + ground_power).max(1.0),
        guts: base.guts,
        wit: base.wit * aptitude_mod,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::course::model::CourseData;
    use crate::shared_kernel::language::{DistanceType, Orientation, Surface};

    fn course(set_status: Vec<ThresholdStat>) -> CourseData {
        CourseData {
            course_id: 1,
            race_track_id: 10001,
            distance: 2400.0,
            distance_type: DistanceType::Long,
            surface: Surface::Turf,
            turn: Orientation::Clockwise,
            course_set_status: set_status,
            corners: vec![],
            straights: vec![],
            slopes: vec![],
            lane_max: 10.0,
            course_width: 30.0,
            horse_lane: 1.5,
            lane_change_acceleration: 0.0,
            lane_change_acceleration_per_frame: 0.0,
            max_lane_distance: 0.0,
            move_lane_point: 0.0,
            is_abroad: false,
        }
    }

    fn stat_line(v: i32) -> StatLine {
        StatLine {
            speed: v,
            stamina: v,
            power: v,
            guts: v,
            wit: v,
        }
    }

    #[test]
    fn mood_coefficient_matches_formula() {
        assert_eq!(mood_coefficient(Mood::Normal), 1.0);
        assert_eq!(mood_coefficient(Mood::Great), 1.04);
        assert_eq!(mood_coefficient(Mood::Awful), 0.96);
    }

    #[test]
    fn base_stats_apply_overcap_and_mood() {
        // 1300 overcaps to 1200 + floor(100/2) = 1250; Great mood (1.04).
        let base = build_base_stats(&stat_line(1300), Mood::Great);
        assert_eq!(base.speed, 1250.0 * 1.04);
        // Below 1200 passes through untouched, Normal mood (1.0).
        let plain = build_base_stats(&stat_line(1000), Mood::Normal);
        assert_eq!(plain.speed, 1000.0);
    }

    #[test]
    fn adjusted_stats_apply_ground_and_aptitude_modifiers() {
        let base = build_base_stats(&stat_line(1000), Mood::Normal);
        // Turf + Heavy: ground speed -50, ground power -50; strategy aptitude A = 1.0.
        let adj = build_adjusted_stats(&base, &course(vec![]), GroundCondition::Heavy, Aptitude::A);
        // No course set status -> speed_modifier = 1.0; speed = 1000*1 - 50 = 950.
        assert_eq!(adj.speed, 950.0);
        assert_eq!(adj.power, 950.0);
        assert_eq!(adj.stamina, 1000.0);
        assert_eq!(adj.wit, 1000.0);
    }

    #[test]
    fn adjusted_stats_floor_at_one() {
        let base = RunnerStats {
            speed: 10.0,
            stamina: 10.0,
            power: 10.0,
            guts: 10.0,
            wit: 10.0,
        };
        // Heavy ground subtracts 50, flooring to 1.
        let adj = build_adjusted_stats(&base, &course(vec![]), GroundCondition::Heavy, Aptitude::A);
        assert_eq!(adj.speed, 1.0);
        assert_eq!(adj.power, 1.0);
    }

    #[test]
    fn course_set_status_raises_speed_modifier() {
        let base = build_base_stats(&stat_line(900), Mood::Normal);
        // One bonus stat (Speed, 900 capped 901 -> floor(900/300.01)=2 -> (1+2)*0.05=0.15).
        let adj = build_adjusted_stats(
            &base,
            &course(vec![ThresholdStat::Speed]),
            GroundCondition::Firm,
            Aptitude::A,
        );
        // speed_modifier = 1.15; Firm turf ground speed mod = 0; 900*1.15 = 1035.
        assert!((adj.speed - 1035.0).abs() < 1e-9);
    }
}
