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

/// Cap on one rushed (temptation) spell.
///
/// A Frenzied-family debuff overwrites `rushed_max_duration` with its own fixed
/// window; this is the value restored when the spell ends, so the overwrite does
/// not carry into a later rush.
pub(super) const RUSHED_MAX_DURATION: f64 = 12.0;

/// Power-conservation parameters, transcribed from `docs/race-mechanics/GLOBAL.md`
/// §13 (Charge Up / Fully Charged). Values the reference leaves unnamed are
/// marked as assumptions so Global tuning can change them in one place.
mod conserve_power {
    /// Power above which a runner may conserve, and the floor the release
    /// acceleration is measured from (`PowerStat - 1200`).
    pub(super) const POWER_FLOOR: f64 = 1200.0;
    /// Gauge gain **per second** while position keep is Pace Down.
    pub(super) const PACE_DOWN_GAIN_PER_SECOND: f64 = 6.7;
    /// Gauge gain **per second** while position keep is Normal/None.
    pub(super) const NORMAL_GAIN_PER_SECOND: f64 = 4.2;
    /// Credit accrues over the first 10 sections of the course only.
    pub(super) const CREDIT_WINDOW_SECTIONS: f64 = 10.0;
    /// Seconds before conserving may restart after it was stopped.
    pub(super) const RESTART_LOCK_SECONDS: f64 = 1.5;
    /// Gauge multiplier applied **once** on entering a Spot Struggle.
    pub(super) const SPOT_STRUGGLE_ENTRY_DECAY: f64 = 0.95;
    /// Gauge multiplier applied **once** on entering Rushed.
    pub(super) const RUSHED_ENTRY_DECAY: f64 = 0.8;
    /// Spot Struggle release activity coefficient.
    pub(super) const SPOT_STRUGGLE_ACTIVITY_COEF: f64 = 0.98;
    /// Rushed release activity coefficient.
    pub(super) const RUSHED_ACTIVITY_COEF: f64 = 0.8;
    /// Divisor of the release-duration formula
    /// (`ConservedPower * sqrt(CourseDistance) * DistanceTypeCoef / 1450`).
    pub(super) const RELEASE_DURATION_DIVISOR: f64 = 1450.0;
    /// A release whose computed duration is shorter than this is skipped.
    ///
    /// The reference states the release rule as "if enough power was conserved"
    /// and then names this floor as the only concrete gate, so it is the whole
    /// "enough power" test.
    pub(super) const MIN_RELEASE_DURATION: f64 = 0.2;
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

/// Gauge gain per second implied by the position-keep state
/// (GLOBAL.md §13: 4.2 normal, 6.7 pace down). The other states stop accrual
/// rather than paying a different rate, so they never reach this table.
fn conserve_power_position_keep_coef(state: PositionKeepState) -> f64 {
    match state {
        PositionKeepState::PaceDown => conserve_power::PACE_DOWN_GAIN_PER_SECOND,
        _ => conserve_power::NORMAL_GAIN_PER_SECOND,
    }
}

/// Style coefficient of the conserve-power gain (GLOBAL.md §13: Front Runner
/// 1.0, Pace Chaser 0.75, Late Surger 1.0, End Closer 0.7). Runaway is not
/// listed, so it takes its base strategy's value through `base_strategy`.
fn conserve_power_style_coef(strategy: Strategy) -> f64 {
    match strategy.base_strategy() {
        Strategy::PaceChaser => 0.75,
        Strategy::EndCloser => 0.7,
        _ => 1.0,
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
        self.rushed_max_duration = RUSHED_MAX_DURATION;
        self.rushed_timer_locked = false;
        self.rushed_activations.clear();
        self.forced_rushed_index = 0;
        self.is_in_forced_rushed = false;

        if self.rushed_enabled && self.rushed_rng.random() < self.rushed_chance() {
            self.rushed_section = 2 + i64::from(self.rushed_rng.uniform(8));
            self.rushed_enter_position = self.section_length * self.rushed_section as f64;
        }
    }

    /// `initializeDownhillMode`.
    pub(crate) fn initialize_downhill_mode(&mut self) {
        self.is_downhill_mode = false;
        self.downhill_mode_start = None;
        self.last_downhill_check_frame = 0;
        self.forced_downhill_index = 0;
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
        self.conserve_power_stat = self.charge_up_power_stat();
        self.conserved_power = 0.0;
        self.conserve_power_restart_left = 0.0;
        self.conserve_power_was_rushed = false;
        self.conserve_power_was_spot_struggling = false;
        self.conserve_power_saw_rushed = false;
        self.conserve_power_saw_spot_struggle = false;
        self.fully_charged_timer.t = 0.0;
        self.fully_charged_duration = 0.0;
        self.fully_charged_accel = 0.0;
        self.fully_charged_region = None;
        self.distance_type = distance_type;
    }

    /// The Wiz the pre-race rushed roll reads: **FinalStat**, i.e.
    /// `AdjustedStat + SkillModifier`.
    ///
    /// The roll runs in `initialize_rushed_state`, before gate skills are
    /// consumed, so a gate `WisdomUp` bonus is not in `adjusted_stats.wit` yet.
    /// It is read off the pending queue instead, through the same gate seam as
    /// the type-29 adjustment. Every `WisdomUp` effect in the extract is
    /// `Direct` (value usage `None` or `1`), so the stored modifier is the whole
    /// contribution and this consumes no RNG.
    fn rushed_roll_wit(&self) -> f64 {
        self.adjusted_stats.wit + self.pending_gate_modifiers(SkillType::WisdomUp)
    }

    /// Modifiers of `effect_type` carried by pending skills that would already
    /// have applied by the time the pre-race rolled state is decided.
    ///
    /// The filter is `trigger.start <= 0.0`, the same condition
    /// `process_skill_activations` uses to fire at the gate. Summing *every*
    /// pending skill would credit one that does not fire until 1200m. All four
    /// type-29 skills in the extract, and all 34 `WisdomUp` effects, are
    /// `always==1` gate skills, so nothing currently depends on the distinction —
    /// it just keeps the seam honest.
    fn pending_gate_modifiers(&self, effect_type: SkillType) -> f64 {
        self.pending_skills
            .iter()
            .filter(|skill| skill.trigger.start <= 0.0)
            .flat_map(|skill| skill.effects.iter())
            .filter(|effect| effect.effect_type == effect_type)
            .map(|effect| effect.modifier)
            .sum()
    }

    /// Base rushed chance **before** the integer-percent ceiling and the type-29
    /// adjustment: `(6.5 / log10(0.1·wit + 1))² / 100`.
    fn base_rushed_chance(&self) -> f64 {
        let wit = self.rushed_roll_wit();
        (6.5 / (0.1 * wit + 1.0).log10()).powi(2) / 100.0
    }

    /// Pre-race rushed-chance adjustment from self `RushedChance` (type 29)
    /// effects, in probability units. Restraint (`202161`) carries a raw
    /// `-30000` modifier (`-3.0` after ×10000 scaling) = −3 percentage points
    /// → `-0.03`; `Hyper Excitement` (`203691`) carries `+400000` = `+0.40`. Read
    /// from the pending queue because the rushed roll in
    /// `initialize_rushed_state` runs before gate skills are consumed. All four
    /// are self-targeted, so the runner's own queue is the right place to look.
    fn rushed_chance_adjustment(&self) -> f64 {
        self.pending_gate_modifiers(SkillType::RushedChance) / 100.0
    }

    /// The chance the pre-race rushed roll uses.
    ///
    /// The game compares an integer RNG against an integer percentage, so the
    /// chance is effectively rounded **up**: 13.26% rolls as 14%. Ceiling
    /// commutes with the integer type-29 adjustment
    /// (`ceil(b) - 3 == ceil(b - 3)`), so the adjustment's position relative to
    /// it does not matter while every type-29 modifier is a whole percentage.
    fn rushed_chance(&self) -> f64 {
        let base = (self.base_rushed_chance() * 100.0).ceil() / 100.0;
        (base + self.rushed_chance_adjustment()).max(0.0)
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

        // Recovery check every 3 seconds (55% chance to snap out). A
        // Frenzied-family debuff suppresses it: the overwritten timer runs its
        // fixed window out with no exit roll, so the cap check below is the only
        // way out of the spell.
        let t = self.rushed_timer.t;
        if !self.rushed_timer_locked
            && t > 0.0
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
        // The Frenzied overwrite is spent with the spell: the fixed window does
        // not carry into a later rush, and the 12s cap does not re-apply.
        self.rushed_timer_locked = false;
        self.rushed_max_duration = RUSHED_MAX_DURATION;
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
        if !self.forced_downhill_regions.is_empty() {
            self.update_forced_downhill();
            return;
        }
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

    /// Scripted downhill mode: on inside the current region and on a
    /// downhill, off otherwise. Regions are consumed in order as the runner
    /// passes their ends.
    fn update_forced_downhill(&mut self) {
        while self
            .forced_downhill_regions
            .get(self.forced_downhill_index)
            .is_some_and(|region| self.position >= region.end)
        {
            self.forced_downhill_index += 1;
        }
        let inside = self
            .forced_downhill_regions
            .get(self.forced_downhill_index)
            .is_some_and(|region| self.position >= region.start);
        let on_downhill = self.current_hill_index != -1 && self.slope_per < 0.0;
        let active = inside && on_downhill;
        if active && !self.is_downhill_mode {
            self.downhill_mode_start = Some((self.accumulate_time.t * 15.0).floor() as i64);
        } else if !active {
            self.downhill_mode_start = None;
        }
        self.is_downhill_mode = active;
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
        // No strategy exclusion: canon (docs/race-mechanics/ "Dueling")
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

    /// The Power stat Charge Up reads (GLOBAL.md §13):
    /// `BasePower + 0.5 * max(RawPower - 1200, 0) + SkillModifier`.
    ///
    /// Past 1200 the base stat is already halved, so the extra `0.5 * overcap`
    /// converts the stat nearly 1:1 instead of 1:2. The skill half is the sum of
    /// `PowerUp` (type 3) modifiers applied this round, tracked separately
    /// because the ground power penalty is part of `adjusted_stats` and is not
    /// part of this stat.
    pub(super) fn charge_up_power_stat(&self) -> f64 {
        let raw = f64::from(self.stats.power);
        self.base_stats.power
            + 0.5 * (raw - conserve_power::POWER_FLOOR).max(0.0)
            + self.power_skill_modifier
    }

    /// Advance the Power Conservation gauge. Release is handled with last-spurt
    /// transition logic so the acceleration window opens exactly at spurt start.
    ///
    /// `dt` is the tick length: the gauge is a per-second rate, so it accrues
    /// continuously rather than in fixed checks.
    pub(crate) fn update_power_conservation(&mut self, dt: f64) {
        if self.is_fully_charged && self.fully_charged_timer.t >= self.fully_charged_duration {
            self.close_fully_charged();
        }

        if !self.conserve_power_enabled || self.is_last_spurt {
            return;
        }

        // Refresh the PowerStat the gate and the release formula read.
        self.conserve_power_stat = self.charge_up_power_stat();

        // Entering a Spot Struggle or a rush costs the gauge once, on the edge.
        // These are penalties on the *gauge*, not on the accrual rate, so they
        // apply whether or not the runner may still accrue credit.
        if self.in_spot_struggle && !self.conserve_power_was_spot_struggling {
            self.conserved_power *= conserve_power::SPOT_STRUGGLE_ENTRY_DECAY;
            self.conserve_power_saw_spot_struggle = true;
        }
        if self.is_rushed && !self.conserve_power_was_rushed {
            self.conserved_power *= conserve_power::RUSHED_ENTRY_DECAY;
            self.conserve_power_saw_rushed = true;
        }
        self.conserve_power_was_spot_struggling = self.in_spot_struggle;
        self.conserve_power_was_rushed = self.is_rushed;

        // Conserving stops while in Speed Up, Overtake, Pace Up or Pace Up Ex,
        // while Rushed, or while in a Spot Struggle, and cannot restart for
        // 1.5 s afterwards.
        let blocked = matches!(
            self.position_keep_state,
            PositionKeepState::SpeedUp
                | PositionKeepState::Overtake
                | PositionKeepState::PaceUp
                | PositionKeepState::PaceUpEx
        ) || self.is_rushed
            || self.in_spot_struggle;
        if blocked {
            self.conserve_power_restart_left = conserve_power::RESTART_LOCK_SECONDS;
        } else {
            self.conserve_power_restart_left = (self.conserve_power_restart_left - dt).max(0.0);
        }

        if blocked || self.conserve_power_restart_left > 0.0 {
            return;
        }
        if self.conserve_power_stat <= conserve_power::POWER_FLOOR {
            return;
        }
        if self.position >= self.section_length * conserve_power::CREDIT_WINDOW_SECTIONS {
            return;
        }

        self.conserved_power += conserve_power_position_keep_coef(self.position_keep_state)
            * conserve_power_style_coef(self.strategy)
            * dt;
    }

    fn begin_fully_charged(&mut self) {
        if !self.conserve_power_enabled
            || self.is_fully_charged
            || self.fully_charged_region.is_some()
            || self.conserve_power_stat <= conserve_power::POWER_FLOOR
        {
            return;
        }

        // Duration is proportional to the gauge that was actually banked, and the
        // gauge being large enough to buy a release is the whole "enough power"
        // test the reference names.
        let duration = self.conserved_power
            * self.course_distance.sqrt()
            * fully_charged_duration_coef(self.distance_type)
            / conserve_power::RELEASE_DURATION_DIVISOR;
        if duration < conserve_power::MIN_RELEASE_DURATION {
            return;
        }

        self.is_fully_charged = true;
        self.fully_charged_timer.t = 0.0;
        self.fully_charged_duration = duration;
        self.fully_charged_accel =
            ((self.conserve_power_stat - conserve_power::POWER_FLOOR) * 130.0).sqrt()
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
                speed_contributions: self.speed_contributions,
            };
            let late_race_target_speed = self.base_target_speed_per_phase[2];
            let (transition, speed) = match self.forced_last_spurt_distance {
                Some(pinned) => self.health_policy.pin_last_spurt_pair(
                    &state,
                    self.last_spurt_speed,
                    late_race_target_speed,
                    pinned,
                ),
                None => self.health_policy.get_last_spurt_pair(
                    &state,
                    self.last_spurt_speed,
                    late_race_target_speed,
                ),
            };
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
    fn rushed_chance_is_ceiled_to_an_integer_percent() {
        let r = test_runner(0, Strategy::PaceChaser);
        // test_runner carries 800 Wiz at A aptitude, so `rushed_roll_wit` is 800:
        // (6.5 / log10(81))^2 = 11.60% raw. The game compares an integer RNG
        // against an integer percentage, so it rolls as 12%.
        let raw_percent = (6.5 / (0.1 * 800.0_f64 + 1.0).log10()).powi(2);
        assert!((raw_percent - 11.60).abs() < 0.01, "raw {raw_percent}");
        assert!((r.rushed_chance() - 0.12).abs() < 1e-12);
    }

    #[test]
    fn rushed_chance_reads_final_wit_and_type_29_adjustment() {
        use crate::shared_kernel::ids::SkillId;
        use crate::shared_kernel::region::Region;
        use crate::skills::effect::{SkillRarity, SkillTarget, SkillType};
        use crate::skills::model::{PendingSkill, SkillEffectSpec};
        use crate::skills::value_scaling::ValueScalingPolicy;

        let mut r = test_runner(0, Strategy::PaceChaser);
        assert!((r.rushed_chance() - 0.12).abs() < 1e-12);

        // Restraint (202161) as the extract stores it: Wisdom Up `60` alongside
        // the type-29 reducer (raw `-30000` -> `-3.0` -> `-0.03` probability).
        r.pending_skills.push(PendingSkill {
            skill_id: SkillId::new("202161"),
            rarity: SkillRarity::White,
            tags: vec![405, 615],
            activate_lot: None,
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
            forced: false,
            cooldown: None,
        });

        // Both effects belong to the runner's own gate skill, so the roll reads
        // FinalStat: 800 + 60 = 860 Wiz, i.e. (6.5 / log10(87))^2 = 11.23%,
        // ceiled to 12%, then the -3 point adjustment.
        assert!((r.rushed_roll_wit() - 860.0).abs() < 1e-12);
        assert!(
            (r.rushed_chance() - 0.09).abs() < 1e-12,
            "got {}",
            r.rushed_chance()
        );
    }

    #[test]
    fn rushed_roll_ignores_pending_wisdom_up_that_fires_later() {
        use crate::shared_kernel::ids::SkillId;
        use crate::shared_kernel::region::Region;
        use crate::skills::effect::{SkillRarity, SkillTarget, SkillType};
        use crate::skills::model::{PendingSkill, SkillEffectSpec};
        use crate::skills::value_scaling::ValueScalingPolicy;

        let mut r = test_runner(0, Strategy::PaceChaser);
        let gate_only = r.rushed_roll_wit();
        r.pending_skills.push(PendingSkill {
            skill_id: SkillId::new("100001"),
            rarity: SkillRarity::White,
            tags: vec![],
            activate_lot: None,
            trigger: Region::new(1200.0, 1210.0),
            effects: vec![SkillEffectSpec {
                target: SkillTarget::SelfTarget,
                effect_type: SkillType::WisdomUp,
                base_duration: -1.0,
                modifier: 60.0,
                value_scaling: ValueScalingPolicy::Direct,
                value_level_usage: None,
            }],
            extra_condition: None,
            target_strategy: None,
            forced: false,
            cooldown: None,
        });
        assert!(
            (r.rushed_roll_wit() - gate_only).abs() < 1e-12,
            "a Wisdom Up that fires at 1200m must not move the pre-race roll"
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
    fn forced_downhill_runs_only_inside_its_region_and_on_a_downhill() {
        use crate::runner::ForcedRegion;
        let mut r = test_runner(0, Strategy::PaceChaser);
        r.forced_downhill_regions = vec![ForcedRegion {
            start: 1000.0,
            end: 1300.0,
        }];
        r.current_hill_index = 0;
        r.slope_per = -1.0;

        r.position = 900.0;
        r.update_downhill_mode(false); // the roll is disabled; the script still applies
        assert!(!r.is_downhill_mode);

        r.position = 1100.0;
        r.update_downhill_mode(false);
        assert!(r.is_downhill_mode);

        r.slope_per = 0.0; // the downhill ended before the recorded spell did
        r.update_downhill_mode(false);
        assert!(!r.is_downhill_mode);

        r.slope_per = -1.0;
        r.position = 1350.0;
        r.update_downhill_mode(false);
        assert!(!r.is_downhill_mode);
        assert_eq!(r.forced_downhill_index, 1);
    }

    #[test]
    fn forced_downhill_keeps_its_entry_frame_while_active() {
        use crate::runner::ForcedRegion;
        let mut r = test_runner(0, Strategy::PaceChaser);
        r.forced_downhill_regions = vec![ForcedRegion {
            start: 1000.0,
            end: 1300.0,
        }];
        r.current_hill_index = 0;
        r.slope_per = -1.0;
        r.position = 1100.0;
        r.accumulate_time.t = 2.0;
        r.update_downhill_mode(false);
        assert_eq!(r.downhill_mode_start, Some(30));

        for tick in 1..=10 {
            r.accumulate_time.t = 2.0 + f64::from(tick) / 15.0;
            r.position += 1.5;
            r.update_downhill_mode(false);
            assert!(r.is_downhill_mode);
            assert_eq!(r.downhill_mode_start, Some(30));
        }

        r.position = 1300.0;
        r.update_downhill_mode(false);
        assert!(!r.is_downhill_mode);
        assert_eq!(r.downhill_mode_start, None);
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
    fn charge_up_power_stat_restores_overcap_and_adds_skill_bonus() {
        let mut r = test_runner(0, Strategy::PaceChaser);
        // 1300 raw overcaps to a 1250 base; the extra half-overcap brings the
        // Charge Up stat back to 1300 (mechanics § Charge Up).
        r.stats.power = 1300;
        r.base_stats.power = 1250.0;
        assert!((r.charge_up_power_stat() - 1300.0).abs() < 1e-9);

        // Under the cap it is the base stat plus applied PowerUp skills.
        r.stats.power = 1000;
        r.base_stats.power = 1000.0;
        r.power_skill_modifier = 60.0;
        assert!((r.charge_up_power_stat() - 1060.0).abs() < 1e-9);
    }

    #[test]
    fn conserve_power_style_coefficients_match_the_reference() {
        assert_eq!(super::conserve_power_style_coef(Strategy::FrontRunner), 1.0);
        assert_eq!(super::conserve_power_style_coef(Strategy::PaceChaser), 0.75);
        assert_eq!(super::conserve_power_style_coef(Strategy::LateSurger), 1.0);
        assert_eq!(super::conserve_power_style_coef(Strategy::EndCloser), 0.7);
        // Runaway is unlisted and takes its base strategy's value.
        assert_eq!(super::conserve_power_style_coef(Strategy::Runaway), 1.0);
    }

    #[test]
    fn power_conservation_accrues_per_second_by_state_and_style() {
        let mut r = test_runner(0, Strategy::PaceChaser);
        r.stats.power = 1300;
        r.base_stats.power = 1250.0;
        r.position_keep_state = PositionKeepState::None;
        r.update_power_conservation(1.0);
        assert!((r.conserved_power - 4.2 * 0.75).abs() < 1e-9);

        r.position_keep_state = PositionKeepState::PaceDown;
        r.update_power_conservation(1.0);
        assert!((r.conserved_power - (4.2 + 6.7) * 0.75).abs() < 1e-9);
    }

    #[test]
    fn power_conservation_stops_and_locks_restart_in_blocking_states() {
        let mut r = test_runner(0, Strategy::FrontRunner);
        r.stats.power = 1300;
        r.base_stats.power = 1250.0;
        r.position_keep_state = PositionKeepState::SpeedUp;
        r.update_power_conservation(1.0);
        assert_eq!(r.conserved_power, 0.0);
        assert!((r.conserve_power_restart_left - 1.5).abs() < 1e-9);

        // Leaving the state does not resume accrual until the lock expires.
        r.position_keep_state = PositionKeepState::None;
        r.update_power_conservation(1.0);
        assert_eq!(r.conserved_power, 0.0);
        r.update_power_conservation(0.5);
        assert!((r.conserved_power - 4.2 * 0.5).abs() < 1e-9);
    }

    #[test]
    fn power_conservation_credit_stops_after_ten_sections() {
        let mut r = test_runner(0, Strategy::FrontRunner);
        r.stats.power = 1300;
        r.base_stats.power = 1250.0;
        r.section_length = 100.0;
        r.position = 1000.0;
        r.update_power_conservation(1.0);
        assert_eq!(r.conserved_power, 0.0);

        r.position = 999.0;
        r.update_power_conservation(1.0);
        assert!((r.conserved_power - 4.2).abs() < 1e-9);
    }

    #[test]
    fn power_conservation_requires_more_than_1200_power() {
        let mut r = test_runner(0, Strategy::FrontRunner);
        r.stats.power = 1200;
        r.base_stats.power = 1200.0;
        r.update_power_conservation(1.0);
        assert_eq!(r.conserved_power, 0.0);
    }

    #[test]
    fn power_conservation_entry_decays_apply_once_on_the_edge() {
        let mut r = test_runner(0, Strategy::FrontRunner);
        r.stats.power = 1300;
        r.base_stats.power = 1250.0;
        r.conserved_power = 100.0;
        r.in_spot_struggle = true;
        r.is_rushed = true;
        r.update_power_conservation(1.0);
        assert!((r.conserved_power - 100.0 * 0.95 * 0.8).abs() < 1e-9);
        assert!(r.conserve_power_saw_spot_struggle);
        assert!(r.conserve_power_saw_rushed);

        // Still rushed and struggling: no second decay, and no accrual.
        r.update_power_conservation(1.0);
        assert!((r.conserved_power - 100.0 * 0.95 * 0.8).abs() < 1e-9);
    }

    #[test]
    fn fully_charged_release_uses_formula_and_duration() {
        let mut r = test_runner(0, Strategy::PaceChaser);
        r.conserve_power_stat = 1400.0;
        r.conserved_power = 100.0;
        r.distance_type = DistanceType::Mid;
        r.course_distance = 2400.0;
        r.position = 1800.0;
        r.begin_fully_charged();
        let expected = ((1400.0_f64 - 1200.0) * 130.0).sqrt() * 0.001 * 0.9;
        assert!(r.is_fully_charged);
        assert!((r.fully_charged_accel - expected).abs() < 1e-12);
        // 100 * sqrt(2400) * 0.875 / 1450
        let expected_duration = 100.0 * 2400.0_f64.sqrt() * 0.875 / 1450.0;
        assert!((r.fully_charged_duration - expected_duration).abs() < 1e-12);
        assert_eq!(r.fully_charged_region, Some((1800.0, -1.0)));
    }

    #[test]
    fn fully_charged_release_needs_a_gauge_worth_more_than_point_two_seconds() {
        let mut r = test_runner(0, Strategy::PaceChaser);
        r.conserve_power_stat = 1300.0;
        r.distance_type = DistanceType::Short;
        r.course_distance = 1000.0;
        // 20 * sqrt(1000) * 0.45 / 1450 = 0.196 s, under the floor.
        r.conserved_power = 20.0;
        r.begin_fully_charged();
        assert!(!r.is_fully_charged);

        // 30 * sqrt(1000) * 0.45 / 1450 = 0.294 s, over it.
        r.conserved_power = 30.0;
        r.begin_fully_charged();
        assert!(r.is_fully_charged);
    }

    #[test]
    fn fully_charged_requires_eligible_power() {
        let mut r = test_runner(0, Strategy::PaceChaser);
        r.conserve_power_stat = 1200.0;
        r.conserved_power = 100.0;
        r.course_distance = 2400.0;
        r.begin_fully_charged();
        assert!(!r.is_fully_charged);

        r.conserve_power_stat = 1300.0;
        r.begin_fully_charged();
        assert!(r.is_fully_charged);
    }

    #[test]
    fn fully_charged_closes_after_duration() {
        let mut r = test_runner(0, Strategy::PaceChaser);
        r.conserve_power_stat = 1300.0;
        r.conserved_power = 100.0;
        r.distance_type = DistanceType::Mid;
        r.course_distance = 2400.0;
        r.position = 1700.0;
        r.begin_fully_charged();
        r.position = 1760.0;
        r.fully_charged_timer.t = r.fully_charged_duration;
        r.update_power_conservation(1.0 / 15.0);
        assert!(!r.is_fully_charged);
        assert_eq!(r.fully_charged_region, Some((1700.0, 1760.0)));
    }
}
