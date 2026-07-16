//! Game mechanics: rushed / dueling / spot-struggle / downhill / last-spurt
//! (t-016).
//!
//! Ports the mechanic state machines from `common/runner.ts`. The fully
//! self-contained machines (rushed, downhill, last-spurt) are ported in full.
//! The field-dependent ones read the per-frame snapshot data through the
//! [`UpdateContext`]: dueling resolves its compare-mode (`artificial`) path here;
//! normal-mode **proximity** dueling and the cross-runner **spot-struggle group
//! activation** are coordinated by the aggregate (t-017) since they observe /
//! mutate the rest of the field. Each runner's self-side exit logic lives here.

use crate::runner::physics::{DuelingInput, FieldInputs, UpdateContext};
use crate::runner::Runner;
use crate::shared_kernel::language::{DistanceType, Strategy};
use crate::skills::effect::{PositionKeepState, SkillType};
use crate::stamina::policy::RaceStateSlice;

/// Power-conservation parameters from KuromiAK's mechanics document. Values marked
/// as assumptions are named constants so Global tuning can change them in one place.
mod conserve_power {
    /// The conserved-power gauge threshold required to release Fully Charged.
    ///
    /// The source docs say "if there is enough conserved power" but do not name a
    /// concrete value. 100.0 is a local assumption/tuning point.
    pub(super) const FULLY_CHARGED_THRESHOLD: f64 = 100.0;
    /// Gauge gain per 1.5s check while position keep is Pace Down.
    pub(super) const PACE_DOWN_GAIN: f64 = 6.7;
    /// Gauge gain per 1.5s check while position keep is Normal/None.
    pub(super) const NORMAL_GAIN: f64 = 4.2;
    /// Gauge multiplier applied by Spot Struggle on a conserve check.
    pub(super) const SPOT_STRUGGLE_DECAY: f64 = 0.95;
    /// Gauge multiplier applied by Rushed on a conserve check.
    pub(super) const RUSHED_DECAY: f64 = 0.8;
    /// Conserve checks run every ~1.5 seconds at 15 FPS.
    pub(super) const CHECK_FRAMES: i64 = 23;
    /// Spot Struggle release activity coefficient.
    pub(super) const SPOT_STRUGGLE_ACTIVITY_COEF: f64 = 0.98;
    /// Rushed release activity coefficient.
    pub(super) const RUSHED_ACTIVITY_COEF: f64 = 0.8;
    /// Documented but not yet understood by the release-duration model.
    #[allow(dead_code)]
    pub(super) const ACTIVITY_TIME_COEF: f64 = 1450.0;
}

/// Per-strategy dueling activation rates (percent) used by compare-mode
/// `artificialDueling`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DuelingRates {
    /// Runaway rate.
    pub runaway: f64,
    /// Front-runner rate.
    pub front_runner: f64,
    /// Pace-chaser rate.
    pub pace_chaser: f64,
    /// Late-surger rate.
    pub late_surger: f64,
    /// End-closer rate.
    pub end_closer: f64,
}

fn fully_charged_strategy_distance_coef(strategy: Strategy, distance_type: DistanceType) -> f64 {
    match (strategy.base_strategy(), distance_type) {
        (Strategy::FrontRunner, _) => 1.0,
        (Strategy::PaceChaser, DistanceType::Short) => 0.7,
        (Strategy::PaceChaser, DistanceType::Mile) => 0.8,
        (Strategy::PaceChaser, DistanceType::Mid | DistanceType::Long) => 0.9,
        (Strategy::LateSurger, DistanceType::Short) => 0.75,
        (Strategy::LateSurger, DistanceType::Mile) => 0.7,
        (Strategy::LateSurger, DistanceType::Mid) => 0.875,
        (Strategy::LateSurger, DistanceType::Long) => 1.0,
        (Strategy::EndCloser, DistanceType::Short) => 0.7,
        (Strategy::EndCloser, DistanceType::Mile) => 0.75,
        (Strategy::EndCloser, DistanceType::Mid) => 0.86,
        (Strategy::EndCloser, DistanceType::Long) => 0.9,
        (Strategy::Runaway, _) => 1.0,
    }
}

fn fully_charged_duration_coef(distance_type: DistanceType) -> f64 {
    match distance_type {
        DistanceType::Short => 0.45,
        DistanceType::Mile => 1.0,
        DistanceType::Mid => 0.875,
        DistanceType::Long => 0.8,
    }
}

impl Runner {
    // ===================== initializers =====================

    /// `initializeRushedState`: roll whether (and where) the runner will rush.
    pub(crate) fn initialize_rushed_state(&mut self) {
        self.is_rushed = false;
        self.has_been_rushed = false;
        self.rushed_section = -1;
        self.rushed_enter_position = -1.0;
        self.rushed_end_position = -1.0;
        self.rushed_timer.t = 0.0;
        self.rushed_max_duration = 12.0;
        self.rushed_activations.clear();
        self.forced_rushed_index = 0;
        self.is_in_forced_rushed = false;

        if self.rushed_rng.random() < self.rushed_chance() {
            self.rushed_section = 2 + i64::from(self.rushed_rng.uniform(8));
            self.rushed_enter_position = self.section_length * self.rushed_section as f64;
        }
    }

    /// `initializeDownhillMode`.
    pub(crate) fn initialize_downhill_mode(&mut self) {
        self.is_downhill_mode = false;
        self.downhill_mode_start = None;
        self.last_downhill_check_frame = 0;
    }

    /// `initializeDueling`.
    pub(crate) fn initialize_dueling(&mut self) {
        self.is_dueling = false;
        self.can_duel = None;
        self.has_dueled = false;
        self.dueling_timer.t = 0.0;
        self.dueling_start_position = -1.0;
        self.dueling_end_position = -1.0;
        self.forced_dueling_index = 0;
        self.is_in_forced_dueling = false;
    }

    /// `initializeSpotStruggle`.
    pub(crate) fn initialize_spot_struggle(&mut self) {
        self.in_spot_struggle = false;
        self.has_spot_struggle = false;
        self.spot_struggle_distance_exited = false;
        self.spot_struggle_timer.t = 0.0;
        self.spot_struggle_start_position = None;
        self.spot_struggle_end_position = -1.0;
        self.forced_spot_struggle_index = 0;
        self.is_in_forced_spot_struggle = false;
    }

    /// Initialize the Power Conservation / Fully Charged state.
    pub(crate) fn initialize_power_conservation(&mut self, distance_type: DistanceType) {
        self.is_fully_charged = false;
        self.conserve_power_stat = f64::from(self.stats.power);
        self.conserved_power = 0.0;
        self.last_conserve_power_check_frame = 0;
        self.conserve_power_saw_rushed = false;
        self.conserve_power_saw_spot_struggle = false;
        self.fully_charged_timer.t = 0.0;
        self.fully_charged_duration = 0.0;
        self.fully_charged_accel = 0.0;
        self.fully_charged_region = None;
        self.distance_type = distance_type;
    }

    /// Base rushed chance: `(6.5 / log10(0.1·wit + 1))² / 100`.
    fn base_rushed_chance(&self) -> f64 {
        let wit = self.adjusted_stats.wit;
        (6.5 / (0.1 * wit + 1.0).log10()).powi(2) / 100.0
    }

    /// Pre-race rushed-chance adjustment from self `RushedChance` (type 29)
    /// effects, in probability units. Restraint (`202161`) carries a raw
    /// `-30000` modifier (`-3.0` after ×10000 scaling) = −3 percentage points
    /// → `-0.03`. Read from the pending queue because the rushed roll in
    /// `initialize_rushed_state` runs before gate skills are consumed.
    fn rushed_chance_adjustment(&self) -> f64 {
        self.pending_skills
            .iter()
            .flat_map(|skill| skill.effects.iter())
            .filter(|effect| effect.effect_type == SkillType::RushedChance)
            .map(|effect| effect.modifier / 100.0)
            .sum()
    }

    fn rushed_chance(&self) -> f64 {
        (self.base_rushed_chance() + self.rushed_chance_adjustment()).max(0.0)
    }

    // ===================== rushed =====================

    /// Advance the rushed (temptation) state machine.
    pub(crate) fn update_rushed(&mut self) {
        if self.update_forced_rushed() {
            return;
        }

        if self.rushed_section >= 0
            && !self.is_rushed
            && !self.has_been_rushed
            && self.position >= self.rushed_enter_position
        {
            self.enter_rushed();
        }

        if !self.is_rushed {
            return;
        }

        // Recovery check every 3 seconds (55% chance to snap out).
        let t = self.rushed_timer.t;
        if t > 0.0
            && (t / 3.0).floor() > ((t - 0.017) / 3.0).floor()
            && self.rushed_rng.random() < 0.55
        {
            self.leave_rushed();
            return;
        }
        if self.rushed_timer.t >= self.rushed_max_duration {
            self.leave_rushed();
        }
    }

    /// Handle forced rushed regions; returns `true` when it consumed the tick.
    fn update_forced_rushed(&mut self) -> bool {
        if self.forced_rushed_regions.is_empty()
            || self.forced_rushed_index >= self.forced_rushed_regions.len()
        {
            return false;
        }
        let region = self.forced_rushed_regions[self.forced_rushed_index];

        if !self.is_in_forced_rushed && self.position >= region.start && self.position < region.end
        {
            self.is_rushed = true;
            self.is_in_forced_rushed = true;
            self.pre_rushed_pos_keep_strategy = self.position_keep_strategy;
            self.rushed_timer.t = 0.0;
            self.rushed_activations.push((self.position, -1.0));
            self.apply_rushed_strategy_override();
        }

        if self.is_in_forced_rushed && self.position >= region.end {
            self.is_rushed = false;
            self.is_in_forced_rushed = false;
            self.position_keep_strategy = self.pre_rushed_pos_keep_strategy;
            self.forced_rushed_index += 1;
            self.close_last_rushed_activation();
            return true;
        }

        self.is_in_forced_rushed
    }

    fn enter_rushed(&mut self) {
        self.is_rushed = true;
        self.pre_rushed_pos_keep_strategy = self.position_keep_strategy;
        self.has_been_rushed = true;
        self.rushed_timer.t = 0.0;
        self.rushed_activations.push((self.position, -1.0));
        self.apply_rushed_strategy_override();
    }

    /// While rushed, position-keep behavior is forced by strategy bucket.
    fn apply_rushed_strategy_override(&mut self) {
        let roll = self.rushed_rng.random();
        self.position_keep_strategy = match self.strategy {
            Strategy::Runaway | Strategy::FrontRunner | Strategy::PaceChaser => {
                Strategy::FrontRunner
            }
            Strategy::LateSurger => {
                if roll < 0.75 {
                    Strategy::FrontRunner
                } else {
                    Strategy::PaceChaser
                }
            }
            Strategy::EndCloser => {
                if roll < 0.7 {
                    Strategy::FrontRunner
                } else if roll < 0.9 {
                    Strategy::PaceChaser
                } else {
                    Strategy::LateSurger
                }
            }
        };
    }

    fn leave_rushed(&mut self) {
        self.is_rushed = false;
        self.position_keep_strategy = self.pre_rushed_pos_keep_strategy;
        self.close_last_rushed_activation();
    }

    fn close_last_rushed_activation(&mut self) {
        if let Some(last) = self.rushed_activations.last_mut() {
            if last.1 == -1.0 {
                last.1 = self.position;
            }
        }
    }

    // ===================== downhill =====================

    /// `updateDownhillMode`: enter/exit downhill (HP-saving) mode.
    pub(crate) fn update_downhill_mode(&mut self, downhill_enabled: bool) {
        if !downhill_enabled {
            self.exit_downhill();
            return;
        }
        if self.current_hill_index == -1 || self.slope_per >= 0.0 {
            self.exit_downhill();
            return;
        }

        let current_frame = (self.accumulate_time.t * 15.0).floor() as i64;
        let change_second = current_frame % 15 == 14;
        if !change_second || current_frame == self.last_downhill_check_frame {
            return;
        }
        self.last_downhill_check_frame = current_frame;

        let roll = self.downhill_rng.random();
        if self.downhill_mode_start.is_none() {
            if roll < self.adjusted_stats.wit * 0.0004 {
                self.downhill_mode_start = Some(current_frame);
                self.is_downhill_mode = true;
            }
            return;
        }
        if roll > 0.8 {
            self.downhill_mode_start = None;
            self.is_downhill_mode = false;
        }
    }

    fn exit_downhill(&mut self) {
        if self.is_downhill_mode {
            self.downhill_mode_start = None;
            self.is_downhill_mode = false;
        }
    }

    // ===================== dueling =====================

    /// `updateDueling`. Resolves forced regions, self-exit, gating, and the
    /// compare-mode artificial path. Normal-mode proximity dueling is coordinated
    /// by the aggregate (t-017).
    pub(crate) fn update_dueling(
        &mut self,
        field_inputs: &FieldInputs<'_>,
        ctx: &UpdateContext<'_>,
    ) {
        if self.update_forced_dueling() {
            return;
        }
        if !self.dueling_enabled {
            return;
        }
        if self.is_dueling {
            if self.health_policy.health_ratio_remaining() <= 0.05 {
                self.is_dueling = false;
                self.has_dueled = true;
                self.dueling_end_position = self.position;
            }
            return;
        }
        // No strategy exclusion: canon (docs/mechanics/README.md "Dueling")
        // gates only on final straight, proximity, placement, and HP. Front
        // runners that fall back into the pack can duel; the per-strategy
        // `DuelingRates` (front_runner/runaway arms) govern the artificial path.
        if self.health_policy.health_ratio_remaining() < 0.15
            || !self.is_on_final_straight(ctx.course)
        {
            return;
        }

        match field_inputs.dueling {
            DuelingInput::Artificial(rates) => self.artificial_dueling(rates),
            // Contested-field proximity dueling is handled by the aggregate coordinator.
            DuelingInput::Coordinated => {}
        }
    }

    fn update_forced_dueling(&mut self) -> bool {
        if self.forced_dueling_regions.is_empty()
            || self.forced_dueling_index >= self.forced_dueling_regions.len()
        {
            return false;
        }
        let region = self.forced_dueling_regions[self.forced_dueling_index];
        if !self.is_in_forced_dueling
            && !self.is_dueling
            && self.position >= region.start
            && self.position < region.end
        {
            self.is_dueling = true;
            self.is_in_forced_dueling = true;
            self.dueling_start_position = self.position;
        }
        if self.is_in_forced_dueling {
            if self.position >= region.end || self.health_policy.health_ratio_remaining() <= 0.05 {
                self.is_dueling = false;
                self.is_in_forced_dueling = false;
                self.dueling_end_position = self.position;
                self.forced_dueling_index += 1;
            }
            return true;
        }
        false
    }

    fn artificial_dueling(&mut self, dueling_rates: Option<DuelingRates>) {
        if self.can_duel.is_none() {
            match dueling_rates {
                Some(rates) => {
                    let rate = match self.position_keep_strategy {
                        Strategy::Runaway => rates.runaway,
                        Strategy::FrontRunner => rates.front_runner,
                        Strategy::PaceChaser => rates.pace_chaser,
                        Strategy::LateSurger => rates.late_surger,
                        Strategy::EndCloser => rates.end_closer,
                    };
                    self.can_duel = Some(self.dueling_rng.random() < rate / 100.0);
                    self.dueling_timer.t = 0.0;
                }
                None => self.can_duel = Some(false),
            }
        }
        if self.can_duel != Some(true) {
            return;
        }
        if self.dueling_timer.t >= 2.0 {
            if self.dueling_rng.random() <= 0.4 {
                self.is_dueling = true;
                self.dueling_start_position = self.position;
            } else {
                self.dueling_timer.t = 0.0;
            }
        }
    }

    // ===================== spot struggle =====================

    /// Spot-struggle duration: `(700*guts)^0.5 * 0.012` scaled by the runner's
    /// strategy proficiency modifier (S 1.1 .. G 0.1 - the same wit-adjustment
    /// table). Real-data evidence: hakuraku.moe/notes/spot-struggle,
    /// "Aptitude appears to scale duration".
    fn spot_struggle_duration(&self) -> f64 {
        let proficiency = crate::course::coefficients::strategy_module::aptitude_modifier(
            self.aptitudes.strategy,
        );
        (700.0 * self.adjusted_stats.guts).powf(0.5) * 0.012 * proficiency
    }

    /// `updateSpotStruggle` self-side: forced regions, exit, and duration. The
    /// cross-runner trigger (which activates a group of front-runners) is run by
    /// the aggregate coordinator (t-017).
    pub(crate) fn update_spot_struggle(&mut self, _ctx: &UpdateContext<'_>) {
        if self.update_forced_spot_struggle() {
            return;
        }
        if !self.spot_struggle_enabled {
            return;
        }
        if self.in_spot_struggle {
            let duration = self.spot_struggle_duration();
            if self.spot_struggle_timer.t >= duration
                || self.position >= self.spot_struggle_end_position
            {
                self.in_spot_struggle = false;
                self.spot_struggle_end_position = self.position;
            }
        }
        // Group trigger detection and the distance/lateral exit are handled by
        // the aggregate coordinators.
    }

    fn update_forced_spot_struggle(&mut self) -> bool {
        if self.forced_spot_struggle_regions.is_empty()
            || self.forced_spot_struggle_index >= self.forced_spot_struggle_regions.len()
        {
            return false;
        }
        let region = self.forced_spot_struggle_regions[self.forced_spot_struggle_index];
        if !self.is_in_forced_spot_struggle
            && !self.in_spot_struggle
            && self.position >= region.start
            && self.position < region.end
        {
            self.in_spot_struggle = true;
            self.is_in_forced_spot_struggle = true;
            self.spot_struggle_start_position = Some(self.position);
            self.spot_struggle_end_position = region.end;
            self.spot_struggle_timer.t = 0.0;
        }
        if self.is_in_forced_spot_struggle {
            let duration = self.spot_struggle_duration();
            if self.position >= region.end || self.spot_struggle_timer.t >= duration {
                self.in_spot_struggle = false;
                self.is_in_forced_spot_struggle = false;
                self.spot_struggle_end_position = self.position;
                self.forced_spot_struggle_index += 1;
            }
            return true;
        }
        false
    }

    // ===================== power conservation / fully charged =====================

    /// Advance the Power Conservation gauge. Release is handled with last-spurt
    /// transition logic so the acceleration window opens exactly at spurt start.
    pub(crate) fn update_power_conservation(&mut self) {
        if self.is_fully_charged && self.fully_charged_timer.t >= self.fully_charged_duration {
            self.close_fully_charged();
        }

        if !self.conserve_power_enabled || self.conserve_power_stat <= 1200.0 || self.is_last_spurt
        {
            return;
        }

        if self.is_rushed {
            self.conserve_power_saw_rushed = true;
        }
        if self.in_spot_struggle {
            self.conserve_power_saw_spot_struggle = true;
        }

        let current_frame = (self.accumulate_time.t * 15.0).floor() as i64;
        if current_frame <= 0
            || current_frame == self.last_conserve_power_check_frame
            || current_frame % conserve_power::CHECK_FRAMES != 0
        {
            return;
        }
        self.last_conserve_power_check_frame = current_frame;

        match self.position_keep_state {
            PositionKeepState::PaceDown => {
                self.conserved_power += conserve_power::PACE_DOWN_GAIN;
            }
            PositionKeepState::None => {
                self.conserved_power += conserve_power::NORMAL_GAIN;
            }
            _ => {}
        }

        if self.in_spot_struggle {
            self.conserved_power *= conserve_power::SPOT_STRUGGLE_DECAY;
        }
        if self.is_rushed {
            self.conserved_power *= conserve_power::RUSHED_DECAY;
        }
    }

    fn begin_fully_charged(&mut self) {
        if !self.conserve_power_enabled
            || self.is_fully_charged
            || self.fully_charged_region.is_some()
            || self.conserve_power_stat <= 1200.0
            || self.conserved_power < conserve_power::FULLY_CHARGED_THRESHOLD
        {
            return;
        }

        self.is_fully_charged = true;
        self.fully_charged_timer.t = 0.0;
        self.fully_charged_duration = 3.0 * fully_charged_duration_coef(self.distance_type);
        self.fully_charged_accel = ((self.conserve_power_stat - 1200.0) * 130.0).sqrt()
            * 0.001
            * fully_charged_strategy_distance_coef(self.strategy, self.distance_type)
            * self.fully_charged_activity_coef();
        self.fully_charged_region = Some((self.position, -1.0));
    }

    fn close_fully_charged(&mut self) {
        self.is_fully_charged = false;
        if let Some(region) = self.fully_charged_region.as_mut() {
            if region.1 == -1.0 {
                region.1 = self.position;
            }
        }
    }

    fn fully_charged_activity_coef(&self) -> f64 {
        let mut coef = 1.0;
        if self.conserve_power_saw_spot_struggle {
            coef *= conserve_power::SPOT_STRUGGLE_ACTIVITY_COEF;
        }
        if self.conserve_power_saw_rushed {
            coef *= conserve_power::RUSHED_ACTIVITY_COEF;
        }
        coef
    }

    // ===================== last spurt =====================

    /// `updateLastSpurtState(false)`: per-tick last-spurt transition check.
    pub(crate) fn update_last_spurt_state(&mut self) {
        self.update_last_spurt(false);
    }

    /// Forced last-spurt re-evaluation (used after a mid-race recovery).
    pub(crate) fn force_last_spurt_check(&mut self) {
        self.update_last_spurt(true);
    }

    fn update_last_spurt(&mut self, force: bool) {
        if self.is_last_spurt || self.phase.index() < 2 {
            return;
        }
        if self.last_spurt_transition == -1.0 || force {
            let initial_speed = self.last_spurt_speed;
            let state = RaceStateSlice {
                phase: self.phase,
                position_keep_state: self.position_keep_state,
                is_rushed: self.is_rushed,
                is_downhill_mode: self.is_downhill_mode,
                in_spot_struggle: self.in_spot_struggle,
                pos_keep_strategy: Some(self.position_keep_strategy),
                pos: self.position,
                current_speed: self.current_speed,
            };
            let late_race_target_speed = self.base_target_speed_per_phase[2];
            let (transition, speed) = self.health_policy.get_last_spurt_pair(
                &state,
                self.last_spurt_speed,
                late_race_target_speed,
            );
            self.last_spurt_transition = transition;
            self.last_spurt_speed = speed;

            if self.health_policy.is_max_spurt() {
                self.has_achieved_full_spurt = true;
                self.is_last_spurt = true;
                self.begin_fully_charged();
                return;
            }

            self.non_full_spurt_velocity_diff = Some(self.last_spurt_speed - initial_speed);
            self.non_full_spurt_delay_distance = if self.last_spurt_transition >= 0.0 {
                Some(self.last_spurt_transition - self.course_distance * 2.0 / 3.0)
            } else {
                None
            };
        }

        if self.position >= self.last_spurt_transition {
            self.is_last_spurt = true;
            self.begin_fully_charged();
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::runner::test_support::test_runner;
    use crate::shared_kernel::language::{DistanceType, Strategy};
    use crate::skills::effect::PositionKeepState;

    #[test]
    fn spot_struggle_duration_scales_with_strategy_aptitude() {
        use crate::shared_kernel::language::Aptitude;
        let mut r = test_runner(0, Strategy::FrontRunner);
        r.adjusted_stats.guts = 1200.0;
        r.aptitudes.strategy = Aptitude::A;
        let base = r.spot_struggle_duration();
        assert!((base - (700.0f64 * 1200.0).powf(0.5) * 0.012).abs() < 1e-9);

        // S multiplies by 1.1; G collapses the duration to 10%
        // (hakuraku.moe/notes/spot-struggle).
        r.aptitudes.strategy = Aptitude::S;
        assert!((r.spot_struggle_duration() - base * 1.1).abs() < 1e-9);
        r.aptitudes.strategy = Aptitude::G;
        assert!((r.spot_struggle_duration() - base * 0.1).abs() < 1e-9);
    }

    #[test]
    fn rushed_strategy_override_buckets_front_runner() {
        let mut r = test_runner(0, Strategy::PaceChaser);
        r.apply_rushed_strategy_override();
        assert_eq!(r.position_keep_strategy, Strategy::FrontRunner);
    }

    #[test]
    fn rushed_chance_reduced_by_type_29_effect() {
        use crate::shared_kernel::ids::SkillId;
        use crate::shared_kernel::region::Region;
        use crate::skills::effect::{SkillTarget, SkillType};
        use crate::skills::model::{PendingSkill, SkillEffectSpec};
        use crate::skills::value_scaling::ValueScalingPolicy;

        let mut r = test_runner(0, Strategy::PaceChaser);
        let base = r.base_rushed_chance();
        assert!(
            (r.rushed_chance() - base).abs() < 1e-12,
            "no type-29 skill: no adjustment"
        );

        // Restraint (202161): the type-5 wisdom effect plus the type-29 rushed
        // reducer (raw -30000 -> -3.0 -> -0.03 probability).
        r.pending_skills.push(PendingSkill {
            skill_id: SkillId::new("202161"),
            rarity: crate::skills::effect::SkillRarity::White,
            tags: vec![405, 615],
            trigger: Region::new(0.0, 1.0),
            effects: vec![
                SkillEffectSpec {
                    target: SkillTarget::SelfTarget,
                    effect_type: SkillType::WisdomUp,
                    base_duration: -1.0,
                    modifier: 60.0,
                    value_scaling: ValueScalingPolicy::Direct,
                    value_level_usage: Some(1),
                },
                SkillEffectSpec {
                    target: SkillTarget::SelfTarget,
                    effect_type: SkillType::RushedChance,
                    base_duration: -1.0,
                    modifier: -3.0,
                    value_scaling: ValueScalingPolicy::Direct,
                    value_level_usage: Some(1),
                },
            ],
            extra_condition: None,
            target_strategy: None,
        });

        assert!(
            (r.rushed_chance() - (base - 0.03)).abs() < 1e-12,
            "type-29 effect must lower the rushed chance by 0.03"
        );
    }

    #[test]
    fn enter_and_leave_rushed_restores_strategy() {
        let mut r = test_runner(0, Strategy::LateSurger);
        r.position = 500.0;
        r.position_keep_strategy = Strategy::LateSurger;
        r.enter_rushed();
        assert!(r.is_rushed);
        assert!(r.has_been_rushed);
        assert_eq!(r.rushed_activations.len(), 1);
        r.position = 560.0;
        r.leave_rushed();
        assert!(!r.is_rushed);
        assert_eq!(r.position_keep_strategy, Strategy::LateSurger);
        assert_eq!(r.rushed_activations[0].1, 560.0);
    }

    #[test]
    fn downhill_exits_when_not_on_downhill() {
        let mut r = test_runner(0, Strategy::PaceChaser);
        r.is_downhill_mode = true;
        r.current_hill_index = -1;
        r.update_downhill_mode(true);
        assert!(!r.is_downhill_mode);
    }

    #[test]
    fn last_spurt_noop_before_late_race() {
        let mut r = test_runner(0, Strategy::PaceChaser);
        // phase defaults to EarlyRace.
        r.update_last_spurt_state();
        assert!(!r.is_last_spurt);
    }

    #[test]
    fn last_spurt_engages_in_late_race_with_noop_policy() {
        use crate::shared_kernel::language::Phase;
        let mut r = test_runner(0, Strategy::PaceChaser);
        r.phase = Phase::LateRace;
        r.base_target_speed_per_phase = [18.0, 19.0, 20.0];
        r.last_spurt_speed = 21.0;
        r.position = 100.0;
        // NoopStaminaPolicy returns (-1, max_speed) and is_max_spurt() == false,
        // so transition = -1 (spurt whole leg) and position >= -1 engages spurt.
        r.update_last_spurt_state();
        assert!(r.is_last_spurt);
    }

    #[test]
    fn power_conservation_gains_by_position_keep_state() {
        let mut r = test_runner(0, Strategy::PaceChaser);
        r.conserve_power_stat = 1300.0;
        r.accumulate_time.t = 23.0 / 15.0;
        r.position_keep_state = PositionKeepState::None;
        r.update_power_conservation();
        assert!((r.conserved_power - 4.2).abs() < 1e-9);

        r.accumulate_time.t = 46.0 / 15.0;
        r.position_keep_state = PositionKeepState::PaceDown;
        r.update_power_conservation();
        assert!((r.conserved_power - 10.9).abs() < 1e-9);
    }

    #[test]
    fn power_conservation_applies_activity_decay() {
        let mut r = test_runner(0, Strategy::PaceChaser);
        r.conserve_power_stat = 1300.0;
        r.accumulate_time.t = 23.0 / 15.0;
        r.position_keep_state = PositionKeepState::None;
        r.in_spot_struggle = true;
        r.is_rushed = true;
        r.update_power_conservation();
        assert!((r.conserved_power - 4.2 * 0.95 * 0.8).abs() < 1e-9);
        assert!(r.conserve_power_saw_spot_struggle);
        assert!(r.conserve_power_saw_rushed);
    }

    #[test]
    fn fully_charged_release_uses_formula_and_duration() {
        let mut r = test_runner(0, Strategy::PaceChaser);
        r.conserve_power_stat = 1400.0;
        r.conserved_power = 100.0;
        r.distance_type = DistanceType::Mid;
        r.position = 1800.0;
        r.begin_fully_charged();
        let expected = ((1400.0_f64 - 1200.0) * 130.0).sqrt() * 0.001 * 0.9;
        assert!(r.is_fully_charged);
        assert!((r.fully_charged_accel - expected).abs() < 1e-12);
        assert!((r.fully_charged_duration - 2.625).abs() < 1e-12);
        assert_eq!(r.fully_charged_region, Some((1800.0, -1.0)));
    }

    #[test]
    fn fully_charged_requires_eligibility_and_threshold() {
        let mut r = test_runner(0, Strategy::PaceChaser);
        r.conserve_power_stat = 1200.0;
        r.conserved_power = 100.0;
        r.begin_fully_charged();
        assert!(!r.is_fully_charged);

        r.conserve_power_stat = 1300.0;
        r.conserved_power = 99.9;
        r.begin_fully_charged();
        assert!(!r.is_fully_charged);
    }

    #[test]
    fn fully_charged_closes_after_duration() {
        let mut r = test_runner(0, Strategy::PaceChaser);
        r.conserve_power_stat = 1300.0;
        r.conserved_power = 100.0;
        r.position = 1700.0;
        r.begin_fully_charged();
        r.position = 1760.0;
        r.fully_charged_timer.t = r.fully_charged_duration;
        r.update_power_conservation();
        assert!(!r.is_fully_charged);
        assert_eq!(r.fully_charged_region, Some((1700.0, 1760.0)));
    }
}
