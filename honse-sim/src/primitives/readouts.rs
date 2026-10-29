//! Pre-race readouts: closed-form values that describe a build before it runs.
//!
//! Every value here is already used inside the engines; this module is where
//! they live so a caller that only wants the number does not re-derive it. The
//! engines call these functions too, so a planner and a simulation can never
//! disagree about what a stat is worth.
//!
//! These are closed forms over stats and course length, plus the finish-line
//! conversions that turn a simulated finish-time gap into the game's
//! photo-finish margin. Anything that needs the race to actually run — HP
//! actually consumed, finishing order — comes from the simulation, not this
//! module.

use crate::course::coefficients::speed;
use crate::course::phase::phase_start;
use crate::runner::stats::{build_adjusted_stats_from_course_facts, build_base_stats, RunnerStats};
use crate::shared_kernel::language::{
    Aptitude, GroundCondition, Mood, Phase, Strategy, Surface, ThresholdStat,
};
use crate::shared_kernel::params::StatLine;
use crate::stamina::spurt::{
    calculate_base_speed, calculate_equivalent_stamina, calculate_hp_per_second,
    calculate_required_hp, get_ground_consumption_coef, HP_STRATEGY_COEFFICIENT,
};

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

/// The nominal speed the game converts a finish-time gap with, in m/s.
const FINISH_GAP_SPEED: f64 = 15.0;

/// Photo-finish margin bands in meters, smallest first. The band bound is
/// inclusive, so a gap of exactly `0.2m` is still a nose.
const FINISH_MARGIN_BANDS: [(&str, f64); 3] = [("nose", 0.2), ("head", 0.4), ("neck", 0.8)];

/// The ground a finish-time gap is worth, in meters: `delta * 15 m/s`.
///
/// This is the game's own finish-line conversion, and it reads **actual** race
/// time — the `* 1.18` display scale never enters it.
///
/// ```
/// use honse_sim::readouts::finish_gap_meters;
///
/// assert!((finish_gap_meters(1.0) - 15.0).abs() < 1e-12);
/// ```
#[must_use]
pub fn finish_gap_meters(delta_seconds: f64) -> f64 {
    delta_seconds * FINISH_GAP_SPEED
}

/// The photo-finish margin name for a finish-time gap: `"nose"` (`<= 0.2m`),
/// `"head"` (`<= 0.4m`), `"neck"` (`<= 0.8m`), or `None` for a wider gap.
///
/// The sign of the gap is a direction, not a magnitude, so it is ignored.
///
/// ```
/// use honse_sim::readouts::finish_margin;
///
/// assert_eq!(finish_margin(0.0), Some("nose"));
/// assert_eq!(finish_margin(0.05), Some("neck"));
/// assert_eq!(finish_margin(1.0), None);
/// ```
#[must_use]
pub fn finish_margin(delta_seconds: f64) -> Option<&'static str> {
    let gap = finish_gap_meters(delta_seconds.abs());
    FINISH_MARGIN_BANDS
        .iter()
        .find(|(_, max)| gap <= *max)
        .map(|(name, _)| *name)
}

/// Last-spurt base-speed ratio in `LastSpurtSpeedMax`.
const LAST_SPURT_BASE_SPEED_RATIO: f64 = 0.01;
/// Overall `LastSpurtSpeedMax` multiplier.
const LAST_SPURT_MULTIPLIER: f64 = 1.05;
/// Guts term base in `LastSpurtSpeedMax`.
const LAST_SPURT_GUTS_BASE: f64 = 450.0;
/// Guts term exponent in `LastSpurtSpeedMax`.
const LAST_SPURT_GUTS_EXPONENT: f64 = 0.597;
/// Guts term scale in `LastSpurtSpeedMax`.
const LAST_SPURT_GUTS_SCALE: f64 = 0.0001;

/// Buffer distance (meters) the game keeps before the finish in spurt math.
///
/// The engine and this module share the one constant, so a planner and a race
/// can never disagree about where the spurt window closes.
pub const SPURT_BUFFER_METERS: f64 = 60.0;

/// The last-spurt target speed for a build.
///
/// `(BaseTargetSpeed_phase2 + 0.01 * BaseSpeed) * 1.05
///  + sqrt(500 * Speed) * DistanceProficiency * 0.002
///  + (450 * Guts) ^ 0.597 * 0.0001`
///
/// The runner kernel calls this to seed `last_spurt_speed`, so a planner
/// quoting a spurt speed and a race reaching one read the same formula.
///
/// ```
/// use honse_sim::readouts::last_spurt_speed;
/// use honse_sim::shared_kernel::language::{Aptitude, Strategy};
///
/// // A 2400m course at base 19.6 m/s.
/// let speed = last_spurt_speed(Strategy::LateSurger, 19.6, 1200.0, Aptitude::A, 600.0);
/// assert!((speed - 24.013).abs() < 0.001);
/// ```
#[must_use]
pub fn last_spurt_speed(
    strategy: Strategy,
    base_speed: f64,
    speed_stat: f64,
    distance_aptitude: Aptitude,
    guts_stat: f64,
) -> f64 {
    let proficiency = speed::distance_proficiency(distance_aptitude);
    let speed_term = (500.0 * speed_stat).sqrt() * proficiency * 0.002;
    let late_race_target_speed =
        base_speed * speed::strategy_phase_coefficient(strategy, 2) + speed_term;

    let mut result = (late_race_target_speed + LAST_SPURT_BASE_SPEED_RATIO * base_speed)
        * LAST_SPURT_MULTIPLIER
        + speed_term;
    result +=
        (LAST_SPURT_GUTS_BASE * guts_stat).powf(LAST_SPURT_GUTS_EXPONENT) * LAST_SPURT_GUTS_SCALE;
    result
}

/// HP consumed per second at `velocity` on the spurt leg, where the guts
/// modifier is always in force.
///
/// The multiplication order matches the drain the engine applies, so this is
/// the same number a race charges.
#[must_use]
pub fn spurt_hp_per_second(
    velocity: f64,
    base_speed: f64,
    ground_coefficient: f64,
    guts_multiplier: f64,
    status_modifier: f64,
) -> f64 {
    calculate_hp_per_second(
        velocity,
        base_speed,
        ground_coefficient,
        guts_multiplier,
        status_modifier,
        true,
    )
}

/// HP the remainder of the race costs a runner spurting at `spurt_speed` from
/// the late-race line.
///
/// This is the threshold `GameStaminaPolicy::get_last_spurt_pair` compares
/// current health against: meet it and the runner is granted a full spurt on
/// the spot, miss it and the game walks its target speed down until the wisdom
/// roll accepts a slower plan. The engines call this function to make that
/// decision, so a planner cannot quote a different bar than the race applies.
///
/// `spurt_speed` is [`last_spurt_speed`], and `status_modifier` is the
/// engine's `status_modifier` for the state being assumed (1.0 for a clean
/// run).
#[must_use]
pub fn spurt_hp_requirement(
    distance: f64,
    spurt_speed: f64,
    base_speed: f64,
    ground_coefficient: f64,
    guts_multiplier: f64,
    status_modifier: f64,
) -> f64 {
    let remaining = distance - phase_start(distance, Phase::LateRace);
    let seconds = (remaining - SPURT_BUFFER_METERS) / spurt_speed;

    spurt_hp_per_second(
        spurt_speed,
        base_speed,
        ground_coefficient,
        guts_multiplier,
        status_modifier,
    ) * seconds
}

/// Estimated HP a race costs before the late-race line.
///
/// Early race runs `distance / 6` at `base * coefficient[0]` and mid race
/// `distance / 2` at `base * coefficient[1]`, neither with the guts modifier —
/// the engine's own phase targets through its own [`calculate_hp_per_second`].
///
/// It is an estimate, not a race: the start dash runs below target speed and
/// acceleration costs nothing here, so it reads slightly high. High is the safe
/// direction, because the margin it feeds then errs pessimistic.
#[must_use]
pub fn estimated_early_mid_hp(
    distance: f64,
    strategy: Strategy,
    base_speed: f64,
    ground_coefficient: f64,
    guts_multiplier: f64,
) -> f64 {
    let leg = |phase_column: usize, length: f64| {
        calculate_required_hp(
            base_speed * speed::strategy_phase_coefficient(strategy, phase_column),
            length,
            base_speed,
            ground_coefficient,
            guts_multiplier,
            false,
        )
    };

    // Early race is the first sixth; mid race runs from `d/6` to `2d/3`, so it
    // is half the course long.
    leg(0, distance / 6.0) + leg(1, distance / 2.0)
}

/// One build's HP budget over one course, from closed forms only.
///
/// What a build brings — its stamina, guts, speed, strategy, and recoveries —
/// against what the course asks. [`spurt_hp_required`](Self::spurt_hp_required)
/// is the engine's own full-spurt threshold, so
/// [`reaches_full_spurt`](Self::reaches_full_spurt) means the same thing here
/// as it does in a race.
///
/// What it cannot price is everything that only happens once the race runs:
/// when each recovery lands relative to the spurt decision, downhill sections,
/// rushed or spot-struggle stretches, duels, and the wisdom roll. Those are the
/// gap between this and a simulated answer.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StaminaBudget {
    /// HP the runner starts with.
    pub max_hp: f64,
    /// Stamina's conversion coefficient for the strategy.
    pub strategy_coefficient: f64,
    /// Late-race HP burn multiplier from guts.
    pub guts_hp_burn_multiplier: f64,
    /// Course base speed.
    pub base_speed: f64,
    /// Surface × ground-condition HP consumption coefficient.
    pub ground_consumption_coefficient: f64,
    /// Last-spurt target speed.
    pub spurt_speed: f64,
    /// Ground the spurt window covers: `distance / 3 - 60`.
    pub spurt_distance: f64,
    /// HP burned per second at spurt speed.
    pub spurt_hp_per_second: f64,
    /// HP the remainder of the race costs at spurt speed.
    pub spurt_hp_required: f64,
    /// HP the entered recoveries restore, capped at one bar.
    pub heal_hp: f64,
    /// Estimated HP the race costs before the late-race line.
    pub early_mid_hp: f64,
    /// Estimated HP left in the bar when the spurt decision is made:
    /// `max_hp - early_mid_hp`. This, not `max_hp`, is what the spurt window
    /// is paid from.
    pub hp_at_late_race: f64,
    /// `hp_at_late_race + heal_hp - spurt_hp_required`; negative means the
    /// build cannot pay for a full spurt.
    pub hp_margin: f64,
    /// What `heal_hp` is worth in stamina points *at the current max HP*.
    pub stamina_equivalent_healed: f64,
    /// Adjusted stamina the budget was priced with: overcap and mood applied,
    /// course modifiers not (none reach stamina).
    pub adjusted_stamina: f64,
    /// Adjusted guts the budget was priced with.
    pub adjusted_guts: f64,
    /// Adjusted speed the budget was priced with, after the course's threshold
    /// bonus and ground penalty.
    pub adjusted_speed: f64,
    /// Lowest stamina that clears the spurt window, recoveries included.
    ///
    /// In adjusted-stamina points, like [`adjusted_stamina`](Self::adjusted_stamina),
    /// so the two compare directly. Recoveries restore a share of max HP and
    /// max HP rises with stamina, so the heal share is applied to the whole
    /// bar: a build with heals needs less stamina than the heals alone suggest.
    pub stamina_requirement: f64,
    /// Whether the budget covers a full spurt.
    pub reaches_full_spurt: bool,
}

/// The course, build, and recoveries [`stamina_budget`] reads.
#[derive(Debug, Clone, PartialEq)]
pub struct StaminaBudgetInput {
    /// Course distance in meters.
    pub distance: f64,
    /// Track surface.
    pub surface: Surface,
    /// Ground (track) condition.
    pub ground: GroundCondition,
    /// Running style.
    pub strategy: Strategy,
    /// Motivation.
    pub mood: Mood,
    /// Raw input stats, before overcap and mood adjustment.
    pub stats: StatLine,
    /// Distance aptitude, which scales the spurt's speed term.
    pub distance_aptitude: Aptitude,
    /// Strategy aptitude, which scales adjusted wit.
    pub strategy_aptitude: Aptitude,
    /// The course's threshold stats, averaged into the adjusted-speed bonus.
    pub course_set_status: Vec<ThresholdStat>,
    /// Total recovery the build brings, in raw (×10000) units of max HP, as
    /// stored on a Recovery skill effect.
    pub heal_basis_points: f64,
    /// HP-consumption multiplier for the conditions assumed: 1.0 for a clean
    /// run, otherwise the engine's `status_modifier` for rushed, spot
    /// struggle, downhill, or pace-down.
    pub status_modifier: f64,
}

/// Price a build's HP against a course, with no race run.
///
/// Stats are adjusted exactly as a race adjusts them (overcap, mood, course
/// threshold bonus, ground penalties), then the last-spurt threshold is
/// computed from those adjusted stats.
///
/// ```
/// use honse_sim::readouts::{stamina_budget, StaminaBudgetInput};
/// use honse_sim::shared_kernel::language::{
///     Aptitude, GroundCondition, Mood, Strategy, Surface,
/// };
/// use honse_sim::shared_kernel::params::StatLine;
///
/// let budget = stamina_budget(&StaminaBudgetInput {
///     distance: 2400.0,
///     surface: Surface::Turf,
///     ground: GroundCondition::Firm,
///     strategy: Strategy::LateSurger,
///     mood: Mood::Normal,
///     stats: StatLine { speed: 1200, stamina: 1200, power: 1000, guts: 600, wit: 1000 },
///     distance_aptitude: Aptitude::A,
///     strategy_aptitude: Aptitude::A,
///     course_set_status: vec![],
///     heal_basis_points: 0.0,
///     status_modifier: 1.0,
/// });
///
/// // 0.8 * 1.0 * 1200 + 2400
/// assert_eq!(budget.max_hp, 3360.0);
/// ```
#[must_use]
pub fn stamina_budget(input: &StaminaBudgetInput) -> StaminaBudget {
    let base = build_base_stats(&input.stats, input.mood);
    let adjusted = build_adjusted_stats_from_course_facts(
        &base,
        input.surface,
        input.ground,
        &input.course_set_status,
        input.strategy_aptitude,
    );

    stamina_budget_from_adjusted(input, &adjusted)
}

/// [`stamina_budget`] for a caller that already holds adjusted stats — one that
/// read them off a prepared runner instead of deriving them.
#[must_use]
pub fn stamina_budget_from_adjusted(
    input: &StaminaBudgetInput,
    adjusted: &RunnerStats,
) -> StaminaBudget {
    let base_speed = calculate_base_speed(input.distance);
    let ground_coefficient = get_ground_consumption_coef(input.surface, input.ground);
    let strategy_coefficient = hp_strategy_coefficient(input.strategy);
    let guts_multiplier = guts_hp_burn_multiplier(adjusted.guts);
    let max_hp = max_hp(adjusted.stamina, input.strategy, input.distance);

    let spurt_speed = last_spurt_speed(
        input.strategy,
        base_speed,
        adjusted.speed,
        input.distance_aptitude,
        adjusted.guts,
    );
    let hp_per_second = spurt_hp_per_second(
        spurt_speed,
        base_speed,
        ground_coefficient,
        guts_multiplier,
        input.status_modifier,
    );
    let spurt_hp_required = spurt_hp_requirement(
        input.distance,
        spurt_speed,
        base_speed,
        ground_coefficient,
        guts_multiplier,
        input.status_modifier,
    );

    // The engine caps every recovery at the health ceiling as it lands, so no
    // combination of heals can restore more than one bar. Capping the total
    // applies that same ceiling to a build whose heals all arrive before it
    // tops out. Where each recovery lands is the simulation's question, not
    // this one's.
    let heal_basis_points = input.heal_basis_points.clamp(0.0, 10_000.0);
    let heal_fraction = heal_basis_points / 10_000.0;
    let heal_hp = heal_fraction * max_hp;

    let estimated_early_mid = estimated_early_mid_hp(
        input.distance,
        input.strategy,
        base_speed,
        ground_coefficient,
        guts_multiplier,
    );
    // The late-race line sits two thirds in, so early and mid race are already
    // paid for by the time the spurt decision is made. Comparing the threshold
    // against a full bar instead would pass nearly every build, because the
    // `distance` term in `max_hp` is larger than the spurt ever costs.
    let hp_at_late_race = max_hp - estimated_early_mid;
    let hp_available = hp_at_late_race + heal_hp;

    // Solve `hp_margin == 0` for stamina. Only `max_hp` moves with it, and one
    // stamina point buys `0.8 * coefficient` HP; recoveries scale with the bar
    // too, hence `1 + heal_fraction` on both sides of the `distance` term.
    let healed = 1.0 + heal_fraction;
    let stamina_requirement = ((spurt_hp_required + estimated_early_mid - healed * input.distance)
        / (healed * 0.8 * strategy_coefficient))
        .max(0.0);

    StaminaBudget {
        max_hp,
        strategy_coefficient,
        guts_hp_burn_multiplier: guts_multiplier,
        base_speed,
        ground_consumption_coefficient: ground_coefficient,
        spurt_speed,
        spurt_distance: input.distance
            - phase_start(input.distance, Phase::LateRace)
            - SPURT_BUFFER_METERS,
        spurt_hp_per_second: hp_per_second,
        spurt_hp_required,
        heal_hp,
        early_mid_hp: estimated_early_mid,
        hp_at_late_race,
        hp_margin: hp_available - spurt_hp_required,
        stamina_equivalent_healed: calculate_equivalent_stamina(
            heal_basis_points,
            max_hp,
            input.strategy as usize,
        ),
        adjusted_stamina: adjusted.stamina,
        adjusted_guts: adjusted.guts,
        adjusted_speed: adjusted.speed,
        stamina_requirement,
        reaches_full_spurt: hp_available >= spurt_hp_required,
    }
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
    fn finish_margins_match_the_documented_bands() {
        // Bounds are inclusive, so an exact 0.2m gap is still a nose.
        assert_eq!(finish_margin(0.2 / 15.0), Some("nose"));
        assert_eq!(finish_margin(0.4 / 15.0), Some("head"));
        assert_eq!(finish_margin(0.8 / 15.0), Some("neck"));
        assert_eq!(finish_margin(0.8 / 15.0 + 1e-9), None);
        // Direction is not magnitude.
        assert_eq!(finish_margin(-0.05), Some("neck"));
    }

    #[test]
    fn finish_gap_reads_actual_time_not_the_display_scale() {
        assert!((finish_gap_meters(1.0) - 15.0).abs() < 1e-12);
        assert!((finish_gap_meters(0.0)).abs() < 1e-12);
    }

    #[test]
    fn chance_is_the_percent_over_one_hundred() {
        assert!((skill_activation_chance(600.0) - 0.85).abs() < 1e-9);
    }

    /// A 2400m Late Surger with the stats this module's examples use.
    fn build() -> StaminaBudgetInput {
        StaminaBudgetInput {
            distance: 2400.0,
            surface: Surface::Turf,
            ground: GroundCondition::Firm,
            strategy: Strategy::LateSurger,
            mood: Mood::Normal,
            stats: StatLine {
                speed: 1200,
                stamina: 1200,
                power: 1000,
                guts: 600,
                wit: 1000,
            },
            distance_aptitude: Aptitude::A,
            strategy_aptitude: Aptitude::A,
            course_set_status: vec![],
            heal_basis_points: 0.0,
            status_modifier: 1.0,
        }
    }

    #[test]
    fn last_spurt_speed_matches_the_hand_computed_value() {
        // Late Surger late-race coefficient 0.994, distance aptitude A = 1.0.
        let speed = last_spurt_speed(Strategy::LateSurger, 19.6, 1200.0, Aptitude::A, 600.0);
        assert!((speed - 24.012_959).abs() < 1e-5, "got {speed}");
    }

    #[test]
    fn distance_aptitude_scales_the_spurt_speed_term() {
        let good = last_spurt_speed(Strategy::LateSurger, 19.6, 1200.0, Aptitude::S, 600.0);
        let poor = last_spurt_speed(Strategy::LateSurger, 19.6, 1200.0, Aptitude::G, 600.0);
        assert!(poor < good);
    }

    #[test]
    fn the_spurt_window_is_the_last_third_less_the_buffer() {
        let budget = stamina_budget(&build());
        // 2400 / 3 - 60
        assert!((budget.spurt_distance - 740.0).abs() < 1e-9);
        // And the requirement is that window at spurt speed.
        let expected = budget.spurt_hp_per_second * budget.spurt_distance / budget.spurt_speed;
        assert!((budget.spurt_hp_required - expected).abs() < 1e-9);
    }

    #[test]
    fn the_early_and_mid_estimate_covers_the_first_two_thirds() {
        let budget = stamina_budget(&build());
        let direct = estimated_early_mid_hp(
            2400.0,
            Strategy::LateSurger,
            budget.base_speed,
            budget.ground_consumption_coefficient,
            budget.guts_hp_burn_multiplier,
        );
        assert!((budget.early_mid_hp - direct).abs() < 1e-9);
        // Plausible for two thirds of a 2400m run: a few hundred HP early,
        // over a thousand through the long middle.
        assert!(budget.early_mid_hp > 1200.0 && budget.early_mid_hp < 2000.0);
    }

    #[test]
    fn the_margin_is_read_at_the_late_race_line_not_from_a_full_bar() {
        let budget = stamina_budget(&build());
        assert!((budget.hp_at_late_race - (budget.max_hp - budget.early_mid_hp)).abs() < 1e-9);
        assert!(
            (budget.hp_margin - (budget.hp_at_late_race - budget.spurt_hp_required)).abs() < 1e-9
        );
        // A build that is short by a lot, and one that clears comfortably.
        assert!(budget.hp_margin > 0.0 && budget.hp_margin < 400.0);

        let thin = stamina_budget(&StaminaBudgetInput {
            stats: StatLine {
                stamina: 600,
                ..build().stats
            },
            ..build()
        });
        assert!(!thin.reaches_full_spurt);
        assert!(thin.hp_margin < 0.0);
        assert!(thin.stamina_requirement > 600.0);
    }

    #[test]
    fn spending_the_requirement_leaves_exactly_no_margin() {
        let input = build();
        let first = stamina_budget(&input);
        // Feeds a fractional stamina back in, which `StatLine`'s integer fields
        // cannot express.
        let at_requirement = stamina_budget_from_adjusted(
            &input,
            &RunnerStats {
                speed: first.adjusted_speed,
                stamina: first.stamina_requirement,
                power: 1000.0,
                guts: first.adjusted_guts,
                wit: 1000.0,
            },
        );
        assert!(at_requirement.hp_margin.abs() < 1e-9);
        assert!(at_requirement.reaches_full_spurt);

        // One point under is short, and the requirement crests above it.
        let under = stamina_budget_from_adjusted(
            &input,
            &RunnerStats {
                stamina: first.stamina_requirement - 1.0,
                ..RunnerStats {
                    speed: first.adjusted_speed,
                    stamina: first.stamina_requirement,
                    power: 1000.0,
                    guts: first.adjusted_guts,
                    wit: 1000.0,
                }
            },
        );
        assert!(under.hp_margin < 0.0);
    }

    #[test]
    fn recoveries_lower_the_floor_by_their_share_of_the_bill() {
        let dry = stamina_budget(&build());
        let healed = stamina_budget(&StaminaBudgetInput {
            heal_basis_points: 1500.0,
            ..build()
        });

        // 1500 bp of a 3360 bar is 504 HP, worth 630 stamina at coefficient 1.0.
        assert!((healed.heal_hp - 504.0).abs() < 1e-9);
        assert!((healed.stamina_equivalent_healed - 630.0).abs() < 1e-9);
        assert!(healed.stamina_requirement < dry.stamina_requirement);

        // How far the floor moves is its own quantity, not the heals' stamina
        // value: recoveries scale with the bar and the bar scales with stamina,
        // so the two trade off. Solving the closed form gives
        //
        //   moved = f * (spurt + early/mid) / ((1 + f) * 0.8 * coefficient)
        //
        // which is why it can land either side of the flat conversion — under
        // 630 on a 2400m course, over it on a long one where the race costs more
        // than the heals are worth.
        let f = 0.15;
        let expected = f * (dry.spurt_hp_required + dry.early_mid_hp)
            / ((1.0 + f) * 0.8 * dry.strategy_coefficient);
        let moved = dry.stamina_requirement - healed.stamina_requirement;

        assert!(
            (moved - expected).abs() < 1e-9,
            "moved {moved}, expected {expected}"
        );
    }

    #[test]
    fn recoveries_are_capped_at_one_bar() {
        let budget = stamina_budget(&StaminaBudgetInput {
            heal_basis_points: 40_000.0,
            ..build()
        });
        assert!((budget.heal_hp - budget.max_hp).abs() < 1e-9);
        assert!((budget.stamina_equivalent_healed - budget.max_hp / 0.8).abs() < 1e-9);
    }

    #[test]
    fn negative_recovery_never_becomes_a_cost() {
        let budget = stamina_budget(&StaminaBudgetInput {
            heal_basis_points: -5000.0,
            ..build()
        });
        assert_eq!(budget.heal_hp, 0.0);
        assert_eq!(budget.stamina_equivalent_healed, 0.0);
    }

    #[test]
    fn overcap_and_mood_reach_the_budget() {
        let plain = stamina_budget(&build());
        let overcapped = stamina_budget(&StaminaBudgetInput {
            stats: StatLine {
                stamina: 1300,
                ..build().stats
            },
            ..build()
        });
        let boosted = stamina_budget(&StaminaBudgetInput {
            mood: Mood::Great,
            stats: StatLine {
                stamina: 1300,
                ..build().stats
            },
            ..build()
        });

        // Overcap takes 1300 to 1200 + 50 = 1250 before mood touches it.
        assert!((overcapped.adjusted_stamina - 1250.0).abs() < 1e-9);
        assert!((overcapped.max_hp - (0.8 * 1250.0 + 2400.0)).abs() < 1e-9);

        // Great mood then multiplies every stat by 1.04.
        assert!((boosted.adjusted_stamina - 1300.0).abs() < 1e-9);
        assert!((boosted.max_hp - (0.8 * 1300.0 + 2400.0)).abs() < 1e-9);
        assert!((boosted.adjusted_speed - 1248.0).abs() < 1e-9);
        assert!((boosted.adjusted_guts - 624.0).abs() < 1e-9);

        // Mood is not free HP: it buys the bar more stamina while it also
        // makes the runner spurt faster and burn more, so neither build is
        // simply the better one.
        assert!(boosted.max_hp > plain.max_hp);
        assert!(boosted.spurt_speed > plain.spurt_speed);
        assert!(boosted.spurt_hp_required > plain.spurt_hp_required);
    }

    #[test]
    fn the_course_threshold_bonus_reaches_adjusted_speed() {
        let plain = stamina_budget(&build());
        let bonused = stamina_budget(&StaminaBudgetInput {
            course_set_status: vec![ThresholdStat::Speed],
            ..build()
        });

        // 1200 speed is past the 901 cap, so the bonus lands at its top tier:
        // (1 + floor(901 / 300.01)) * 0.05 = +20%.
        assert!((bonused.adjusted_speed - 1200.0 * 1.2).abs() < 1e-9);
        assert!(bonused.adjusted_speed > plain.adjusted_speed);
        // Faster spurt burns more HP, so the same build is tighter.
        assert!(bonused.hp_margin < plain.hp_margin);
    }

    #[test]
    fn a_heavier_ground_burns_more_hp() {
        let firm = stamina_budget(&build());
        let heavy = stamina_budget(&StaminaBudgetInput {
            ground: GroundCondition::Heavy,
            ..build()
        });
        assert!((heavy.ground_consumption_coefficient - 1.02).abs() < 1e-9);
        assert!(heavy.hp_margin < firm.hp_margin);
    }

    #[test]
    fn a_status_modifier_scales_the_whole_bill() {
        let clean = stamina_budget(&build());
        let rushed = stamina_budget(&StaminaBudgetInput {
            status_modifier: 1.6,
            ..build()
        });
        assert!((rushed.spurt_hp_required - clean.spurt_hp_required * 1.6).abs() < 1e-6);
        assert!(rushed.hp_margin < clean.hp_margin);
    }
}
