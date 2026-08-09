//! [`GameStaminaPolicy`] — the in-game HP drain / recovery / last-spurt model.
//!
//! Port of `health/game.policy.ts`. Computes max HP from adjusted stats, drains
//! it per tick via the speed/ground/guts/status formula, and resolves the
//! last-spurt transition with a wisdom-based acceptance roll.

use crate::course::model::CourseData;
use crate::course::phase::phase_start;
use crate::shared_kernel::language::{GroundCondition, Phase, Strategy};
use crate::shared_kernel::rng::Prng;
use crate::skills::effect::PositionKeepState;
use crate::stamina::policy::{RaceStateSlice, StaminaPolicy, StaminaStats};
use crate::stamina::spurt::{get_ground_consumption_coef, HP_STRATEGY_COEFFICIENT};

/// Buffer distance (meters) the game keeps before the finish in spurt math.
const SPURT_BUFFER_METERS: f64 = 60.0;
/// The runner's wisdom roll is compared against `subpar_accept_chance` out of
/// this denominator.
const WIT_ROLL_DENOMINATOR: u32 = 100_000;

/// HP-budget policy implementing the live-game stamina model.
pub struct GameStaminaPolicy {
    distance: f64,
    base_speed: f64,
    max_hp: f64,
    current_health: f64,
    ground_modifier: f64,
    rng: Box<dyn Prng>,
    guts_modifier: f64,
    subpar_accept_chance: f64,
    achieved_max_spurt: bool,
}

impl GameStaminaPolicy {
    /// Build a policy for `course` raced under `ground`, drawing wisdom rolls
    /// from `rng`. HP starts at `1.0` until [`init`](StaminaPolicy::init) runs
    /// (the first skill-activation round happens before init).
    pub fn new(course: &CourseData, ground: GroundCondition, rng: Box<dyn Prng>) -> Self {
        GameStaminaPolicy {
            distance: course.distance,
            base_speed: 20.0 - (course.distance - 2000.0) / 1000.0,
            max_hp: 1.0,
            current_health: 1.0,
            ground_modifier: get_ground_consumption_coef(course.surface, ground),
            rng,
            guts_modifier: 1.0,
            subpar_accept_chance: 0.0,
            achieved_max_spurt: false,
        }
    }

    fn status_modifier(&self, state: &RaceStateSlice) -> f64 {
        let mut modifier = 1.0;

        if state.is_downhill_mode {
            modifier *= 0.4;
        }

        if state.in_spot_struggle {
            let is_runaway = state.pos_keep_strategy == Some(Strategy::Runaway);
            if state.is_rushed {
                modifier *= if is_runaway { 7.7 } else { 3.6 };
            } else {
                modifier *= if is_runaway { 3.5 } else { 1.4 };
            }
        } else if state.is_rushed {
            modifier *= 1.6;
        }

        if state.position_keep_state == PositionKeepState::PaceDown {
            modifier *= 0.6;
        }

        modifier
    }

    fn hp_per_second(&self, state: &RaceStateSlice, velocity: f64) -> f64 {
        let guts_modifier = if state.phase.index() >= 2 {
            self.guts_modifier
        } else {
            1.0
        };
        (20.0 * (velocity - self.base_speed + 12.0).powi(2) / 144.0)
            * self.status_modifier(state)
            * self.ground_modifier
            * guts_modifier
    }

    /// The last-leg state used for spurt HP estimates: phase pinned to late
    /// race, spot-struggle cleared (keep position-keep state + strategy).
    fn last_leg_state(state: &RaceStateSlice) -> RaceStateSlice {
        RaceStateSlice {
            phase: Phase::LateRace,
            in_spot_struggle: false,
            ..*state
        }
    }

    /// Build the descending-speed candidate `(transition_position, speed)` list,
    /// sorted by total completion time.
    fn build_candidates(
        &self,
        state: &RaceStateSlice,
        last_leg: &RaceStateSlice,
        max_speed: f64,
        base_target_speed2: f64,
    ) -> Vec<(f64, f64)> {
        let remain_distance = self.distance - SPURT_BUFFER_METERS - state.pos;
        let hp_at_base = self.hp_per_second(last_leg, base_target_speed2);
        let mut candidates: Vec<(f64, f64)> = Vec::new();

        let mut speed = max_speed - 0.1;
        while speed >= base_target_speed2 {
            let numerator = base_target_speed2 * self.current_health - hp_at_base * remain_distance;
            let denominator =
                base_target_speed2 * self.hp_per_second(last_leg, speed) - hp_at_base * speed;
            let spurt_duration = (remain_distance / speed).min((numerator / denominator).max(0.0));
            let spurt_distance = spurt_duration * speed;
            candidates.push((self.distance - spurt_distance - SPURT_BUFFER_METERS, speed));
            speed -= 0.1;
        }

        let completion_time =
            |c: &(f64, f64)| (c.0 - state.pos) / base_target_speed2 + (self.distance - c.0) / c.1;
        candidates.sort_by(|a, b| {
            completion_time(a)
                .partial_cmp(&completion_time(b))
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        candidates
    }

    /// Pick a candidate via the wisdom acceptance roll, falling back to the
    /// slowest (last) candidate.
    fn select_candidate(&mut self, candidates: &[(f64, f64)], max_speed: f64) -> (f64, f64) {
        for candidate in candidates {
            if f64::from(self.rng.uniform(WIT_ROLL_DENOMINATOR)) <= self.subpar_accept_chance {
                return *candidate;
            }
        }
        candidates.last().copied().unwrap_or((-1.0, max_speed))
    }
}

impl StaminaPolicy for GameStaminaPolicy {
    fn init(&mut self, stats: &StaminaStats) {
        let coef = HP_STRATEGY_COEFFICIENT
            .get(stats.strategy as usize)
            .copied()
            .unwrap_or(1.0);
        self.max_hp = 0.8 * coef * stats.stamina + self.distance;
        self.current_health = self.max_hp;
        self.guts_modifier = 1.0 + 200.0 / (600.0 * stats.guts).sqrt();
        self.subpar_accept_chance = ((15.0 + 0.05 * stats.wit) * 1000.0).round();
        self.achieved_max_spurt = false;
    }

    fn tick(&mut self, state: &RaceStateSlice, dt: f64) {
        self.current_health -= self.hp_per_second(state, state.current_speed) * dt;
    }

    fn has_remaining_health(&self) -> bool {
        self.current_health > 0.0
    }

    fn health_ratio_remaining(&self) -> f64 {
        (self.current_health / self.max_hp).max(0.0)
    }

    fn recover(&mut self, modifier: f64) {
        self.current_health = self
            .max_hp
            .min(self.current_health + self.max_hp * modifier);
    }

    fn get_last_spurt_pair(
        &mut self,
        state: &RaceStateSlice,
        max_speed: f64,
        base_target_speed2: f64,
    ) -> (f64, f64) {
        let max_dist = self.distance - phase_start(self.distance, Phase::LateRace);
        let s = (max_dist - SPURT_BUFFER_METERS) / max_speed;
        let last_leg = Self::last_leg_state(state);
        let hp_needed = self.hp_per_second(&last_leg, max_speed) * s;

        if self.current_health >= hp_needed {
            self.achieved_max_spurt = true;
            return (-1.0, max_speed);
        }

        let candidates = self.build_candidates(state, &last_leg, max_speed, base_target_speed2);
        self.select_candidate(&candidates, max_speed)
    }

    fn is_max_spurt(&self) -> bool {
        self.achieved_max_spurt
    }

    fn current_health(&self) -> f64 {
        self.current_health
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::course::model::CourseData;
    use crate::shared_kernel::language::{DistanceType, Orientation, Surface};
    use crate::shared_kernel::rng::Xoshiro256StarStar;

    fn course() -> CourseData {
        CourseData {
            course_id: 1,
            race_track_id: 10001,
            distance: 2400.0,
            distance_type: DistanceType::Long,
            surface: Surface::Turf,
            turn: Orientation::Clockwise,
            course_set_status: vec![],
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

    fn slice(phase: Phase, speed: f64) -> RaceStateSlice {
        RaceStateSlice {
            phase,
            position_keep_state: PositionKeepState::None,
            is_rushed: false,
            is_downhill_mode: false,
            in_spot_struggle: false,
            pos_keep_strategy: None,
            pos: 0.0,
            current_speed: speed,
        }
    }

    fn policy() -> GameStaminaPolicy {
        let rng: Box<dyn Prng> = Box::new(Xoshiro256StarStar::from_u64_seed(42));
        let mut p = GameStaminaPolicy::new(&course(), GroundCondition::Firm, rng);
        p.init(&StaminaStats {
            strategy: Strategy::LateSurger,
            stamina: 1200.0,
            guts: 400.0,
            wit: 600.0,
        });
        p
    }

    #[test]
    fn init_sets_max_hp_from_stats() {
        let p = policy();
        // 0.8 * 1.0 (LateSurger) * 1200 + 2400 = 960 + 2400 = 3360
        assert_eq!(p.current_health(), 3360.0);
        assert!((p.health_ratio_remaining() - 1.0).abs() < 1e-9);
    }

    #[test]
    fn tick_drains_hp() {
        let mut p = policy();
        let before = p.current_health();
        p.tick(&slice(Phase::MidRace, 20.0), 1.0);
        assert!(p.current_health() < before);
        assert!(p.has_remaining_health());
    }

    #[test]
    fn guts_modifier_increases_drain_in_spurt_phase() {
        let p = policy();
        let mid = p.hp_per_second(&slice(Phase::MidRace, 22.0), 22.0);
        let late = p.hp_per_second(&slice(Phase::LateRace, 22.0), 22.0);
        assert!(late > mid); // guts modifier > 1 applies in phase 2+
    }

    #[test]
    fn rushed_status_modifier_raises_consumption() {
        let p = policy();
        let mut rushed = slice(Phase::MidRace, 20.0);
        rushed.is_rushed = true;
        let normal = p.hp_per_second(&slice(Phase::MidRace, 20.0), 20.0);
        let rushed_hp = p.hp_per_second(&rushed, 20.0);
        assert!((rushed_hp - normal * 1.6).abs() < 1e-9);
    }

    #[test]
    fn recover_clamps_to_max_hp() {
        let mut p = policy();
        p.tick(&slice(Phase::MidRace, 25.0), 5.0);
        p.recover(10.0); // huge recovery
        assert_eq!(p.current_health(), 3360.0);
    }

    #[test]
    fn full_spurt_when_hp_is_abundant() {
        let mut p = policy();
        // Late-race, leftover HP is plentiful -> commit to max speed.
        let state = slice(Phase::LateRace, 20.0);
        let (transition, speed) = p.get_last_spurt_pair(&state, 24.0, 20.0);
        assert_eq!(transition, -1.0);
        assert_eq!(speed, 24.0);
        assert!(p.is_max_spurt());
    }

    #[test]
    fn subpar_spurt_when_hp_is_low() {
        let mut p = policy();
        // Drain almost everything so a full spurt is impossible.
        p.tick(&slice(Phase::LateRace, 30.0), 100.0);
        assert!(p.current_health() < 50.0);
        let state = RaceStateSlice {
            pos: 1600.0,
            ..slice(Phase::LateRace, 20.0)
        };
        let (transition, speed) = p.get_last_spurt_pair(&state, 24.0, 20.0);
        // A reduced spurt: a real transition point and a bounded speed.
        assert!(transition >= 0.0);
        assert!((20.0..=24.0).contains(&speed));
        assert!(!p.is_max_spurt());
    }
}
