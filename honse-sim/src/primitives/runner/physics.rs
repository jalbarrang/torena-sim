//! Per-tick movement: speed/acceleration, lane changes, position integration.
//!
//! Port of the physics half of `common/runner.ts`: `onUpdate` and its kinematic
//! helpers (`updateTargetSpeed`, `applyForces`, `applyLaneMovement`, the phase /
//! hill / timer updates), plus the speed/accel initializers
//! (`initializeSpeedCalculations`, `calculatePhaseBaseAccel`, …).
//!
//! Like the position-keep service, the physics methods read race-derived state
//! through a [`UpdateContext`] value built by the aggregate each tick, rather
//! than a `runner.race` back-pointer. The skill-activation (t-015) and game
//! mechanics (t-016) steps `on_update` invokes are currently no-op stubs in
//! `skills.rs` / `mechanics.rs`; they are fleshed out by their owning tasks.

use crate::course::coefficients::{
    acceleration, speed, strategy_module, BASE_ACCEL, FORCE_IN_LANE_THRESHOLD_FRACTION,
    PHASE_DECELERATION, TARGET_SPEED_CAP, UPHILL_BASE_ACCEL,
};
use crate::course::model::CourseData;
use crate::course::phase::phase_start;
use crate::position_keep::{apply_virtual_position_keep, PositionKeepContext};
use crate::runner::mechanics::DuelingRates;
use crate::runner::skills::FieldView;
use crate::runner::Runner;
use crate::shared_kernel::ids::RunnerId;
use crate::shared_kernel::language::Phase;
use crate::shared_kernel::math::CompensatedAccumulator;
use crate::skills::condition::approximate::{
    create_blocked_side_condition, create_overtake_condition, ApproximateCondition,
    ApproximateConditionState,
};
use crate::skills::effect::PositionKeepState;
use crate::stamina::policy::{RaceStateSlice, SpeedContributions};

/// Per-tick accumulators for skill-driven speed / acceleration modifiers.
///
/// Mirrors the TypeScript `SpeedModifiers`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SpeedModifiers {
    /// Target-speed modifier accumulator.
    pub target_speed: CompensatedAccumulator,
    /// Current-speed (displacement) modifier accumulator.
    pub current_speed: CompensatedAccumulator,
    /// Acceleration modifier accumulator.
    pub accel: CompensatedAccumulator,
    /// One-frame acceleration impulse (reset to zero each tick).
    pub one_frame_accel: f64,
    /// Duration scaling applied to special skills.
    pub special_skill_duration_scaling: f64,
}

impl SpeedModifiers {
    /// A fresh zeroed set of modifiers.
    pub fn zeroed() -> Self {
        SpeedModifiers {
            target_speed: CompensatedAccumulator::new(0.0),
            current_speed: CompensatedAccumulator::new(0.0),
            accel: CompensatedAccumulator::new(0.0),
            one_frame_accel: 0.0,
            special_skill_duration_scaling: 1.0,
        }
    }
}

/// A resolved hill segment `[start, end)` and its slope (per-10000 grade).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Hill {
    /// Segment start position.
    pub start: f64,
    /// Segment end position.
    pub end: f64,
    /// Slope value (positive = uphill, negative = downhill).
    pub slope: f64,
}

/// A read-only snapshot of another runner used by the live (normal-mode)
/// proximity checks in `Runner::apply_lane_movement`.
///
/// The aggregate (t-017) rebuilds these once per tick.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RunnerSnapshot {
    /// The snapshotted runner's identity.
    pub id: RunnerId,
    /// Longitudinal position in meters.
    pub position: f64,
    /// Lateral lane offset.
    pub current_lane: f64,
    /// Current speed in m/s.
    pub current_speed: f64,
    /// Target speed in m/s (overtake targets compare it).
    pub target_speed: f64,
    /// Whether a runner blocked this one in front last tick.
    pub is_front_blocked: bool,
}

/// The runner blocking in front this tick (mechanics § Front Blocking).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FrontBlock {
    /// The blocking runner.
    pub id: RunnerId,
    /// Meters between the two, `0 < gap < 2`.
    pub distance_gap: f64,
    /// The blocker's speed at the start of the tick, in m/s.
    pub speed: f64,
}

impl FrontBlock {
    /// The speed a blocked runner is held to: 0.988x the blocker's speed
    /// when touching, 1.0x at the 2 m limit (mechanics § Blocking).
    pub fn speed_cap(&self) -> f64 {
        (0.988 + 0.012 * (self.distance_gap / 2.0)) * self.speed
    }
}

/// Pure, race-derived course context the step needs each tick — **no
/// field-presence inputs** (ADR-0005 step "producer lift").
///
/// All field-presence-dependent values reach the step through a pre-resolved
/// [`FieldInputs`] built by the aggregate's *producer* (in the engine crate);
/// this context carries only course/time scalars the step reads regardless of
/// paradigm.
pub struct UpdateContext<'a> {
    /// Course base speed (`20 - (distance - 2000) / 1000`).
    pub base_speed: f64,
    /// Elapsed race time in seconds (drives `finish_time`).
    pub accumulated_time: f64,
    /// The course configuration.
    pub course: &'a CourseData,
}

/// Resolved dueling input (ADR-0005 data seam).
///
/// The step never asks which paradigm produced this; it only reacts to the
/// resolved variant. In a contested field dueling is decided by the aggregate
/// proximity coordinator (the step does nothing); in a synthetic field the step
/// runs artificial dueling with the per-strategy rates (which may be absent).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum DuelingInput {
    /// Contested field: the aggregate coordinator drives proximity dueling.
    Coordinated,
    /// Synthetic field: run artificial dueling with these per-strategy rates.
    Artificial(Option<DuelingRates>),
}

/// Resolved skill-trigger inputs (ADR-0005 data seam).
///
/// Its own structured type rather than a flat scalar, kept cheap by borrowing
/// the field view so the per-tick step allocates nothing. In a contested field
/// this is the live snapshot-derived view; in a synthetic field it is the
/// trivial at-gate view (dynamic conditions were pre-resolved to static regions
/// at prepare time).
#[derive(Debug, Clone, Copy)]
pub struct SkillTriggerInputs<'a> {
    /// The field view dynamic skill conditions are evaluated against.
    pub field: &'a FieldView,
}

/// Field-presence-dependent inputs the pure step consumes, **already resolved**
/// by whoever owns the field (ADR-0005 data seam).
///
/// The step never asks whether a real field exists; it only reads these
/// resolved values. They are produced by the aggregate's *producer*
/// (`resolve_field_inputs` in the engine crate, single engine); under the
/// split each engine will produce them its own way (the contested engine from
/// the live snapshot, the vacuum engine from approximate condition values /
/// synthetic rates), with no paradigm branch in the step itself.
///
/// Touch-point scalars are kept flat per ADR-0005; the resolved dueling and
/// skill-trigger sets are their own structured types.
#[derive(Debug, Clone, Copy)]
pub struct FieldInputs<'a> {
    /// Whether a runner blocks this one to the side (caps inward lane drift).
    pub side_blocked: bool,
    /// Runner blocking this one in front, when a live field can identify it
    /// (mechanics § Front Blocking).
    pub front_block: Option<FrontBlock>,
    /// Whether this runner is overtaking (pushes the target lane outward).
    pub overtaking: bool,
    /// Every active runner's frozen state when a live field exists. Drives
    /// the documented target-lane rules; `None` keeps the synthetic path.
    pub lane_neighbors: Option<&'a [RunnerSnapshot]>,
    /// Resolved dueling input (coordinated vs synthetic).
    pub dueling: DuelingInput,
    /// Resolved pacer / position-keep inputs the virtual pos-keep step consumes.
    pub position_keep: PositionKeepContext,
    /// Resolved skill-trigger inputs the skill-activation step consumes.
    pub skill_triggers: SkillTriggerInputs<'a>,
}

impl Runner {
    /// Advance the runner one `dt`-second step.
    ///
    /// Ports `onUpdate` in exact TS order. Consumes a pre-resolved
    /// [`FieldInputs`] (built by the aggregate's producer) plus the pure course
    /// [`UpdateContext`]; the step itself never reads field-presence (ADR-0005).
    pub fn on_update(&mut self, dt: f64, field_inputs: &FieldInputs<'_>, ctx: &UpdateContext<'_>) {
        let mut dt_after_delay = dt;

        self.update_timers(dt);

        if self.condition_timer.t >= 0.0 {
            self.tick_conditions(ctx.course.horse_lane);
            self.condition_timer.t = -1.0;
        }

        if self.update_start_delay(dt) {
            return;
        }

        // Logic chunks (TS order). `field_inputs` is the pre-resolved field-
        // presence data the aggregate's producer built for this tick; the step
        // only reads it and never asks whether a real field exists.
        self.update_hills();
        self.update_phase(ctx.course.distance);

        self.update_rushed(); // t-016
        self.update_downhill_mode(self.downhill_enabled); // t-016
        self.process_skill_activations(field_inputs.skill_triggers.field, ctx.course.distance); // t-015
        self.process_targeted_skill_activations(ctx.course.distance); // t-015
        apply_virtual_position_keep(self, &field_inputs.position_keep);
        self.update_dueling(field_inputs, ctx); // t-016
        self.update_spot_struggle(ctx); // t-016
        self.update_power_conservation();
        self.update_last_spurt_state(); // t-016
        self.update_target_speed(field_inputs.side_blocked, ctx.course.course_width);
        self.apply_forces();
        match field_inputs.lane_neighbors {
            Some(neighbors) => self.apply_lane_movement_live(neighbors, field_inputs, ctx, dt),
            None => self.apply_lane_movement(field_inputs, ctx, dt),
        }

        // ---- integrate speed ----
        let mut new_speed = if self.current_speed <= self.target_speed {
            (self.current_speed + self.acceleration * dt).min(self.target_speed)
        } else {
            (self.current_speed + self.acceleration * dt).max(self.target_speed)
        };

        let max_start_dash = self.target_speed.min(0.85 * ctx.base_speed);
        if self.start_dash && new_speed > max_start_dash {
            new_speed = max_start_dash;
        }
        if !self.start_dash && self.current_speed < self.min_speed {
            new_speed = self.min_speed;
        }
        self.current_speed = new_speed;
        if !self.start_dash && self.current_speed < self.min_speed {
            self.current_speed = self.min_speed;
        }
        // A runner boxed in behind another is held to that runner's pace
        // (mechanics § Blocking). The cap is on speed, not target speed, so
        // acceleration keeps building and the runner springs once clear.
        if let Some(block) = field_inputs.front_block {
            self.current_speed = self.current_speed.min(block.speed_cap());
        }

        // ---- integrate position ----
        let displacement = self.current_speed + self.modifiers.current_speed.total();
        if self.start_delay_accumulator < 0.0 {
            dt_after_delay = self.start_delay_accumulator.abs();
            self.start_delay_accumulator = 0.0;
        }
        self.position += displacement * dt_after_delay;

        // ---- stamina ----
        let state = self.stamina_state();
        self.health_policy.tick(&state, dt);
        if !self.health_policy.has_remaining_health() && !self.out_of_hp {
            self.out_of_hp = true;
            self.out_of_hp_position = Some(ctx.course.distance - self.position);
        }

        // ---- start-dash exit ----
        if self.start_dash && self.current_speed >= 0.85 * ctx.base_speed {
            self.start_dash = false;
            self.modifiers.accel.add(-24.0);
        }

        self.modifiers.one_frame_accel = 0.0;

        // ---- finish ----
        if !self.finished && self.position >= ctx.course.distance {
            self.finished = true;
            self.finish_time = ctx.accumulated_time;
        }
    }

    /// Build the narrow [`RaceStateSlice`] the stamina policy reads.
    fn stamina_state(&self) -> RaceStateSlice {
        RaceStateSlice {
            phase: self.phase,
            position_keep_state: self.position_keep_state,
            is_rushed: self.is_rushed,
            is_downhill_mode: self.is_downhill_mode,
            in_spot_struggle: self.in_spot_struggle,
            pos_keep_strategy: Some(self.position_keep_strategy),
            pos: self.position,
            current_speed: self.current_speed,
            speed_contributions: self.speed_contributions,
        }
    }

    // ---- timers / conditions ----

    /// Advance all per-runner timers by `dt`.
    ///
    /// t-016 appends its rushed / dueling / spot-struggle timers here.
    fn update_timers(&mut self, dt: f64) {
        self.accumulate_time.advance(dt);
        self.condition_timer.advance(dt);
        self.pos_keep_next_timer.advance(dt);
        // Mechanic timers (rushed / dueling / spot-struggle) share the central
        // timer list in TS; advance them here so their state machines progress.
        self.rushed_timer.advance(dt);
        self.dueling_timer.advance(dt);
        self.spot_struggle_timer.advance(dt);
        self.fully_charged_timer.advance(dt);
        advance_skill_timers(&mut self.target_speed_skills_active, dt);
        advance_skill_timers(&mut self.current_speed_skills_active, dt);
        advance_skill_timers(&mut self.acceleration_skills_active, dt);
        advance_skill_timers(&mut self.lane_movement_skills_active, dt);
        advance_skill_timers(&mut self.change_lane_skills_active, dt);
        advance_targeted_skill_timers(&mut self.targeted_target_speed_active, dt);
        advance_targeted_skill_timers(&mut self.targeted_current_speed_active, dt);
        advance_targeted_skill_timers(&mut self.targeted_acceleration_active, dt);
        advance_targeted_skill_timers(&mut self.targeted_lane_movement_skills_active, dt);
        advance_targeted_skill_timers(&mut self.targeted_change_lane_skills_active, dt);
    }

    /// Advance every registered approximate condition one tick.
    ///
    /// Iteration is sorted by condition name so RNG draws inside
    /// `ApproximateCondition::update` are independent of `HashMap` random
    /// state (otherwise two same-seed races can diverge once anything —
    /// e.g. force-in — reads `condition_values`).
    fn tick_conditions(&mut self, horse_lane: f64) {
        let state = ApproximateConditionState {
            phase: self.phase.index() as i64,
            position: self.position,
            section_length: self.section_length,
            current_lane: self.current_lane,
            horse_lane,
            strategy: self.strategy,
        };
        let conditions = std::mem::take(&mut self.conditions);
        let mut names: Vec<&str> = conditions.keys().map(String::as_str).collect();
        names.sort_unstable();
        for name in names {
            let condition = conditions.get(name).expect("key from map");
            let current = self
                .condition_values
                .get(name)
                .copied()
                .unwrap_or_else(|| condition.value_on_start());
            let new_value = condition.update(&state, current, &mut *self.rng);
            self.condition_values.insert(name.to_owned(), new_value);
        }
        self.conditions = conditions;
    }

    /// Decrement the start-delay budget; returns `true` while the runner is
    /// still waiting at the gate (the rest of the tick is skipped).
    fn update_start_delay(&mut self, dt: f64) -> bool {
        if self.start_delay_accumulator > 0.0 {
            self.start_delay_accumulator -= dt;
            if self.start_delay_accumulator > 0.0 {
                return true;
            }
        }
        false
    }

    // ---- hills / phase ----

    /// Enter/exit hill segments as the runner advances.
    fn update_hills(&mut self) {
        if self.current_hill_index >= 0 {
            let hill = self.hills[self.current_hill_index as usize];
            if self.position > hill.end {
                self.current_hill_index = -1;
                self.slope_per = 0.0;
            }
        }

        if self.current_hill_index == -1 && self.next_hill_to_check < self.hills.len() {
            let next_hill = self.hills[self.next_hill_to_check];
            if self.position >= next_hill.start {
                self.current_hill_index = self.next_hill_to_check as i64;
                self.slope_per = next_hill.slope;
                self.next_hill_to_check += 1;
            }
        }
    }

    /// Advance the race phase (capped at phase 2 for modifier purposes).
    fn update_phase(&mut self, course_distance: f64) {
        if self.position >= self.next_phase_transition && self.phase_index() < 2 {
            let next = self.phase_index() + 1;
            self.phase = index_to_phase(next);
            self.next_phase_transition = phase_start(course_distance, index_to_phase(next + 1));
        }
    }

    fn phase_index(&self) -> usize {
        self.phase.index()
    }

    // ---- speed / forces ----

    /// Recompute the runner's target speed for this tick.
    ///
    /// `side_blocked` / `course_width` gate the early-race force-in modifier
    /// (mechanics § Target Speed): applied when the runner is more than
    /// `0.12 * course_width` from the inner fence and the inside is open.
    fn update_target_speed(&mut self, side_blocked: bool, course_width: f64) {
        // Cleared every tick: a mechanic that ended must stop being charged for
        // speed it is no longer supplying.
        self.speed_contributions = SpeedContributions::default();

        if !self.health_policy.has_remaining_health() {
            self.target_speed = self.min_speed;
        } else if self.is_last_spurt {
            self.target_speed = self.last_spurt_speed;
        } else {
            let phase = self.phase_index().min(2);
            let mut t = self.base_target_speed_per_phase[phase];
            let section = (self.position / self.section_length).floor() as usize;
            t += self.section_modifiers[section.min(self.section_modifiers.len() - 1)];
            // The coefficient scales only this much of the target, so the speed
            // position keeping is responsible for is the delta it introduces.
            self.speed_contributions.position_keep = t * (self.pos_keep_speed_coef - 1.0);
            t *= self.pos_keep_speed_coef;
            self.target_speed = t;
        }

        self.target_speed += self.modifiers.target_speed.total();

        if self.is_downhill_mode {
            self.speed_contributions.downhill = 0.3 + self.slope_per / 100_000.0;
            self.target_speed += self.speed_contributions.downhill;
        } else if self.current_hill_index != -1 && self.slope_per > 0.0 {
            self.target_speed -= (self.slope_per / 10_000.0) * 200.0 / self.adjusted_stats.power;
            self.target_speed = self.target_speed.max(self.min_speed);
        }

        if self.is_dueling {
            self.speed_contributions.dueling =
                (200.0 * self.adjusted_stats.guts).powf(0.708) * 0.0001;
            self.target_speed += self.speed_contributions.dueling;
        }
        if self.in_spot_struggle {
            self.speed_contributions.spot_struggle =
                (500.0 * self.adjusted_stats.guts).powf(0.6) * 0.0001;
            self.target_speed += self.speed_contributions.spot_struggle;
        }
        if self.lane_change_speed > 0.0 && !self.lane_movement_skills_active.is_empty() {
            self.target_speed += (0.0002 * self.adjusted_stats.power).sqrt();
        }

        // Force-in: early-race only, outer-lane + inside open. Roll is once at
        // prepare (`force_in_speed`); value is Random(0.1)+StrategyModifier.
        if self.phase == Phase::EarlyRace
            && !side_blocked
            && self.current_lane > FORCE_IN_LANE_THRESHOLD_FRACTION * course_width
        {
            self.target_speed += self.force_in_speed;
        }

        self.target_speed = self.target_speed.min(TARGET_SPEED_CAP);
    }

    /// Recompute acceleration for this tick.
    fn apply_forces(&mut self) {
        if !self.health_policy.has_remaining_health() {
            self.acceleration = -1.2;
            return;
        }
        if self.current_speed > self.target_speed {
            self.acceleration = PHASE_DECELERATION[self.phase_index().min(2)];
            if self.position_keep_state == PositionKeepState::PaceDown {
                self.acceleration = -0.5;
            }
            return;
        }
        let uphill = if self.slope_per > 0.0 { 3 } else { 0 };
        self.acceleration = self.base_accelerations[uphill + self.phase_index().min(2)];
        self.acceleration += self.modifiers.accel.total();
        if self.is_dueling {
            self.acceleration += (160.0 * self.adjusted_stats.guts).powf(0.59) * 0.0001;
        }
        if self.is_fully_charged {
            self.acceleration += self.fully_charged_accel;
        }
    }

    /// Arm the final-corner lane on entering the final corner (mechanics
    /// § Extra Move Lane): `clamp(lane / 0.1, 0, 1) * 0.5 + random(0.1)` in
    /// course widths, kept here in meters.
    fn arm_extra_move_lane(&mut self, course: &CourseData) {
        if self.extra_move_lane >= 0.0 || !self.is_after_final_corner_or_in_final_straight(course) {
            return;
        }
        let lane_widths = self.current_lane / course.course_width;
        let target_widths =
            (lane_widths / 0.1).clamp(0.0, 1.0) * 0.5 + self.lane_movement_rng.random() * 0.1;
        self.extra_move_lane = (target_widths * course.course_width).min(course.max_lane_distance);
    }

    /// Advance the lane toward the target by one tick at `actual_speed`
    /// course widths per second (mechanics § Lane Change Speed). Moving in is
    /// faster by `1 + lane` with the lane in course widths.
    fn step_lane(&mut self, actual_speed: f64, course: &CourseData, dt: f64) {
        let current_lane = self.current_lane;
        let step = actual_speed * dt * course.course_width;
        if self.target_lane > current_lane {
            self.current_lane = self.target_lane.min(current_lane + step);
        } else {
            self.current_lane = self
                .target_lane
                .max(current_lane - step * (1.0 + current_lane / course.course_width));
        }
    }

    /// Update lateral lane position (and side-block / overtake telemetry).
    fn apply_lane_movement(
        &mut self,
        field_inputs: &FieldInputs<'_>,
        ctx: &UpdateContext<'_>,
        dt: f64,
    ) {
        let course = ctx.course;
        let current_lane = self.current_lane;

        let side_blocked = field_inputs.side_blocked;
        let overtake = field_inputs.overtaking;

        self.arm_extra_move_lane(course);

        if !self.change_lane_skills_active.is_empty() {
            self.target_lane = 9.5 * course.horse_lane;
        } else if overtake {
            self.target_lane = self
                .target_lane
                .max(course.horse_lane)
                .max(self.extra_move_lane);
        } else if !self.health_policy.has_remaining_health() {
            self.target_lane = current_lane;
        } else if self.extra_move_lane > current_lane {
            self.target_lane = self.extra_move_lane;
        } else if self.phase_index() <= 1 && !side_blocked {
            self.target_lane = (current_lane - 0.05).max(0.0);
        } else {
            self.target_lane = current_lane;
        }

        if (side_blocked && self.target_lane < current_lane)
            || (self.target_lane - current_lane).abs() < 0.00001
        {
            self.lane_change_speed = 0.0;
        } else {
            let mut target_speed = 0.02 * (0.3 + 0.001 * self.adjusted_stats.power);
            if self.position < course.move_lane_point {
                target_speed *= 1.0 + (current_lane / course.max_lane_distance) * 0.05;
            }
            self.lane_change_speed = (self.lane_change_speed
                + course.lane_change_acceleration_per_frame)
                .min(target_speed);

            let lane_skill_bonus: f64 = self
                .lane_movement_skills_active
                .iter()
                .map(|s| s.modifier)
                .sum();
            let actual_speed = (self.lane_change_speed + lane_skill_bonus).min(0.6);
            self.step_lane(actual_speed, course, dt);
        }

        self.is_side_blocked = side_blocked;
        self.front_blocker = field_inputs.front_block.map(|block| block.id);
        self.is_overtaking = overtake;
    }

    /// Lane movement over a live field: the documented target-lane rules
    /// (mechanics § Target Lane) with the documented lane change speed.
    fn apply_lane_movement_live(
        &mut self,
        neighbors: &[RunnerSnapshot],
        field_inputs: &FieldInputs<'_>,
        ctx: &UpdateContext<'_>,
        dt: f64,
    ) {
        use crate::runner::lane::{
            overlap_bump, overtake_targets, resolve_target_lane, side_space_free, LaneCourse,
            LaneMode, LaneSelf, OVERTAKE_LINGER_SECONDS,
        };
        let course = ctx.course;
        let lane_course = LaneCourse {
            course_width: course.course_width,
            horse_lane: course.horse_lane,
            max_lane_distance: course.max_lane_distance,
        };
        self.arm_extra_move_lane(course);
        let me = |runner: &Self| LaneSelf {
            id: runner.id,
            position: runner.position,
            current_lane: runner.current_lane,
            current_speed: runner.current_speed,
            target_speed: runner.target_speed,
            phase_index: runner.phase_index(),
            extra_move_lane: runner.extra_move_lane,
            out_of_hp: !runner.health_policy.has_remaining_health(),
            pace_down: runner.position_keep_state == PositionKeepState::PaceDown,
            on_final_straight: runner.is_on_final_straight(course),
            front_blocker: field_inputs.front_block.map(|block| block.id),
        };

        let mut force_update = false;
        if let Some(lane) = overlap_bump(&me(self), neighbors, &lane_course) {
            self.current_lane = lane;
            force_update = true;
        }

        let has_targets = !overtake_targets(&me(self), neighbors, &lane_course).is_empty();
        if has_targets {
            self.overtake_linger_left = OVERTAKE_LINGER_SECONDS;
        } else {
            self.overtake_linger_left = (self.overtake_linger_left - dt).max(0.0);
            if self.overtake_linger_left <= 0.0 {
                // Overtake mode is over even if the target lane is not
                // refreshed this tick, so the telemetry does not go stale.
                self.lane_mode = LaneMode::Normal;
            }
        }

        let near_target = (self.current_lane - self.target_lane).abs() < 0.5 * course.horse_lane;
        let blocked_toward_target =
            !side_space_free(&me(self), neighbors, self.target_lane, &lane_course);
        if force_update || near_target || blocked_toward_target {
            if !self.change_lane_skills_active.is_empty() {
                self.target_lane = 9.5 * course.horse_lane;
            } else {
                let lingering = !has_targets && self.overtake_linger_left > 0.0;
                let (mode, lane) =
                    resolve_target_lane(&me(self), neighbors, &lane_course, lingering);
                self.lane_mode = mode;
                self.target_lane = lane;
            }
        }

        self.move_toward_target_lane(neighbors, field_inputs, course, &lane_course, dt);
        self.is_side_blocked = field_inputs.side_blocked;
        self.front_blocker = field_inputs.front_block.map(|block| block.id);
        self.is_overtaking = self.lane_mode == LaneMode::Overtake;
    }

    /// Move toward the target lane at the documented lane change speed
    /// (mechanics § Lane Change Speed). A move blocked on its side does not
    /// happen, but the lane change speed keeps building.
    fn move_toward_target_lane(
        &mut self,
        neighbors: &[RunnerSnapshot],
        field_inputs: &FieldInputs<'_>,
        course: &CourseData,
        lane_course: &crate::runner::lane::LaneCourse,
        dt: f64,
    ) {
        use crate::runner::lane::{side_space_free, LaneSelf};
        let current_lane = self.current_lane;
        if (self.target_lane - current_lane).abs() < 0.00001 {
            self.lane_change_speed = 0.0;
            return;
        }
        let mut target_speed = 0.02 * (0.3 + 0.001 * self.adjusted_stats.power);
        if self.phase_index() <= 1 && self.position < course.move_lane_point {
            target_speed *= 1.0 + (current_lane / course.max_lane_distance) * 0.05;
        }
        if self.phase_index() >= 2 {
            let order = field_inputs.skill_triggers.field.self_order.unwrap_or(0);
            target_speed *= 1.0 + order as f64 * 0.01;
        }
        self.lane_change_speed =
            (self.lane_change_speed + course.lane_change_acceleration_per_frame).min(target_speed);

        let me = LaneSelf {
            id: self.id,
            position: self.position,
            current_lane,
            current_speed: self.current_speed,
            target_speed: self.target_speed,
            phase_index: self.phase_index(),
            extra_move_lane: self.extra_move_lane,
            out_of_hp: false,
            pace_down: false,
            on_final_straight: false,
            front_blocker: None,
        };
        if !side_space_free(&me, neighbors, self.target_lane, lane_course) {
            return;
        }
        let lane_skill_bonus: f64 = self
            .lane_movement_skills_active
            .iter()
            .map(|s| s.modifier)
            .sum();
        let actual_speed = (self.lane_change_speed + lane_skill_bonus).clamp(0.0, 0.6);
        self.step_lane(actual_speed, course, dt);
    }

    pub fn is_on_final_straight(&self, course: &CourseData) -> bool {
        match course.straights.last() {
            Some(last) => self.position >= last.start && self.position <= last.end,
            None => false,
        }
    }

    fn is_after_final_corner(&self, course: &CourseData) -> bool {
        match course.corners.last() {
            Some(last) => self.position >= last.start,
            None => false,
        }
    }

    fn is_after_final_corner_or_in_final_straight(&self, course: &CourseData) -> bool {
        self.is_after_final_corner(course) || self.is_on_final_straight(course)
    }

    // ---- speed/accel math (TS getters) ----

    fn calculate_phase_target_speed(&self, base_speed: f64, phase: usize) -> f64 {
        let phase_coefficient = speed::strategy_phase_coefficient(self.strategy, phase);
        let base_target_speed = base_speed * phase_coefficient;
        if phase == 2 {
            let proficiency = speed::distance_proficiency(self.aptitudes.distance);
            return base_target_speed
                + (500.0 * self.adjusted_stats.speed).sqrt() * proficiency * 0.002;
        }
        base_target_speed
    }

    fn calculate_last_spurt_speed(&self, base_speed: f64) -> f64 {
        let late_race_target_speed = self.base_target_speed_per_phase[2];
        let proficiency = speed::distance_proficiency(self.aptitudes.distance);
        let mut result = (late_race_target_speed + 0.01 * base_speed) * 1.05
            + (500.0 * self.adjusted_stats.speed).sqrt() * proficiency * 0.002;
        result += (450.0 * self.adjusted_stats.guts).powf(0.597) * 0.0001;
        result
    }

    fn calculate_phase_base_accel(&self, accel_modifier: f64, phase: usize) -> f64 {
        let strategy_coefficient = acceleration::strategy_phase_coefficient(self.strategy, phase);
        let ground_type = acceleration::ground_type_proficiency(self.aptitudes.surface);
        let distance = acceleration::distance_proficiency(self.aptitudes.distance);
        accel_modifier
            * (500.0 * self.adjusted_stats.power).sqrt()
            * strategy_coefficient
            * ground_type
            * distance
    }

    // ---- initializers (called by on_prepare seams) ----

    /// `initializePhaseTracking`.
    pub(crate) fn initialize_phase_tracking(&mut self, course_distance: f64) {
        self.phase = Phase::EarlyRace;
        self.next_phase_transition = phase_start(course_distance, Phase::MidRace);
        self.section_length = course_distance / 24.0;
        self.first_position_in_late_race = false;
    }

    /// `initializeMovementState`.
    pub(crate) fn initialize_movement_state(&mut self, base_speed: f64) {
        self.position = 0.0;
        self.acceleration = 0.0;
        self.current_speed = 3.0;
        self.target_speed = 0.85 * base_speed;
        self.start_dash = true;
        self.start_delay = 0.1 * self.rng.random();
        self.start_delay_accumulator = self.start_delay;
        self.modifiers.accel.add(24.0);
        self.finished = false;
    }

    /// `initializeLaneState` (requires the gate to be assigned).
    pub(crate) fn initialize_lane_state(&mut self, horse_lane: f64) {
        let initial_lane = self.gate as f64 * horse_lane;
        self.current_lane = initial_lane;
        self.target_lane = initial_lane;
        self.lane_change_speed = 0.0;
        self.extra_move_lane = -1.0;
        self.force_in_speed = 0.0;
        self.is_side_blocked = false;
        self.front_blocker = None;
        self.is_overtaking = false;
        self.lane_mode = crate::runner::lane::LaneMode::Normal;
        self.overtake_linger_left = 0.0;
    }

    /// `initializeLastSpurt`.
    pub(crate) fn initialize_last_spurt(&mut self) {
        self.is_last_spurt = false;
        self.last_spurt_transition = -1.0;
        self.last_spurt_speed = 0.0;
        self.has_achieved_full_spurt = false;
        self.non_full_spurt_velocity_diff = None;
        self.non_full_spurt_delay_distance = None;
    }

    /// `initializeHills` (slopes must be sorted by start).
    pub(crate) fn initialize_hills(&mut self, course: &CourseData) {
        self.current_hill_index = -1;
        self.next_hill_to_check = 0;
        self.hills = course
            .slopes
            .iter()
            .map(|s| Hill {
                start: s.start,
                end: s.start + s.length,
                slope: s.slope,
            })
            .collect();
        self.slope_per = 0.0;
    }

    /// `initializeSpeedCalculations` (after gate skills, so stats are final).
    pub(crate) fn initialize_speed_calculations(&mut self, base_speed: f64) {
        self.base_target_speed_per_phase = [
            self.calculate_phase_target_speed(base_speed, 0),
            self.calculate_phase_target_speed(base_speed, 1),
            self.calculate_phase_target_speed(base_speed, 2),
        ];
        self.last_spurt_speed = self.calculate_last_spurt_speed(base_speed);
        self.min_speed = 0.85 * base_speed + (200.0 * self.adjusted_stats.guts).sqrt() * 0.001;

        let wit = self.adjusted_stats.wit;
        let mut section_modifiers: Vec<f64> = (0..24)
            .map(|_| {
                let max = (wit / 5500.0) * (wit * 0.1).log10();
                let factor = (max - 0.65 + self.wit_rng.random() * 0.65) / 100.0;
                base_speed * factor
            })
            .collect();
        section_modifiers.push(0.0);
        self.section_modifiers = section_modifiers;

        // Mechanics § Target Speed: ForceInModifier = Random(0.1) + StrategyModifier.
        // Consumes one `random()` draw (same stream class as most other rolls);
        // the previous `uniform(100) * strategy_modifier` form was both unused
        // and an order-of-magnitude too large versus the documented formula.
        let strategy_modifier = strategy_module::force_in_speed_modifier(self.strategy);
        self.force_in_speed = self.rng.random() * 0.1 + strategy_modifier;
    }

    /// Cache per-phase base accelerations and per-slope HP penalties.
    pub(crate) fn initialize_base_accelerations(&mut self, course: &CourseData) {
        let phases = [0usize, 1, 2, 0, 1, 2];
        for (i, &phase) in phases.iter().enumerate() {
            let modifier = if i > 2 { UPHILL_BASE_ACCEL } else { BASE_ACCEL };
            self.base_accelerations[i] = self.calculate_phase_base_accel(modifier, phase);
        }
        self.slope_penalties = course
            .slopes
            .iter()
            .map(|s| (s.slope / 10_000.0) * 200.0 / self.adjusted_stats.power)
            .collect();
    }

    /// Register the compare-mode approximate conditions.
    pub(crate) fn register_approximate_conditions(&mut self) {
        self.conditions.clear();
        self.condition_values.clear();
        self.register_condition("blocked_side", Box::new(create_blocked_side_condition()));
        self.register_condition("overtake", Box::new(create_overtake_condition()));
    }

    fn register_condition(&mut self, name: &str, condition: Box<dyn ApproximateCondition>) {
        let start = condition.value_on_start();
        self.conditions.insert(name.to_owned(), condition);
        self.condition_values
            .entry(name.to_owned())
            .or_insert(start);
    }
}

/// Advance the duration timers of a self active-skill list by `dt`.
fn advance_skill_timers(skills: &mut [crate::skills::model::ActiveSkill], dt: f64) {
    for skill in skills.iter_mut() {
        skill.duration_timer.advance(dt);
    }
}

/// Advance the duration timers of a targeted active-skill list by `dt`.
fn advance_targeted_skill_timers(
    skills: &mut [crate::skills::model::ActiveTargetedSkill],
    dt: f64,
) {
    for skill in skills.iter_mut() {
        skill.skill.duration_timer.advance(dt);
    }
}

/// Map a 0..=3 index back to a [`Phase`] (values above 3 saturate at LastSpurt).
fn index_to_phase(index: usize) -> Phase {
    match index {
        0 => Phase::EarlyRace,
        1 => Phase::MidRace,
        2 => Phase::LateRace,
        _ => Phase::LastSpurt,
    }
}

/// Cross-runner coordinator: mark exactly one runner as "first position in late
/// race" once the leader passes 2/3 of the course (`updateFirstPositionInLateRace`).
///
/// Mirrors the TS behavior where only the highest-id runner does the work; the
/// aggregate calls this once per tick after all runners have stepped.
pub fn update_first_position_in_late_race(runners: &mut [Runner], course_distance: f64) {
    if runners.is_empty() {
        return;
    }
    if runners.iter().any(|r| r.first_position_in_late_race) {
        return;
    }

    // Sorted indices by position descending.
    let mut order: Vec<usize> = (0..runners.len()).collect();
    order.sort_by(|&a, &b| {
        runners[b]
            .position
            .partial_cmp(&runners[a].position)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let leader = order[0];
    if runners[leader].position < course_distance * 2.0 / 3.0 {
        return;
    }

    let leader_rounded = (runners[leader].position * 100.0).round() / 100.0;
    let mut tied: Vec<usize> = Vec::new();
    for &idx in &order {
        let rounded = (runners[idx].position * 100.0).round() / 100.0;
        if (rounded - leader_rounded).abs() < f64::EPSILON {
            tied.push(idx);
        } else {
            break;
        }
    }

    // The coordinator (highest id) provides the tie-break draw.
    let coordinator = runners
        .iter()
        .enumerate()
        .max_by_key(|(_, r)| r.id.0)
        .map_or(0, |(i, _)| i);
    let pick = runners[coordinator].sync_rng.uniform(tied.len() as u32) as usize;
    runners[tied[pick]].first_position_in_late_race = true;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runner::lifecycle::PrepareContext;
    use crate::runner::skills::FieldView;
    use crate::runner::test_support::{
        test_course, test_race_params, test_runner, test_whole_course,
    };
    use crate::shared_kernel::language::Strategy;
    use crate::shared_kernel::params::RaceParameters;
    use crate::shared_kernel::region::RegionList;
    use crate::shared_kernel::rng::Xoshiro256StarStar;
    use crate::skills::condition::catalog::build_catalog;
    use crate::skills::condition::language::ConditionParser;
    use crate::skills::condition::{ConditionCatalog, ConditionResolution};

    /// Owned prerequisites for building a `PrepareContext` in tests.
    struct Prereqs {
        course: CourseData,
        catalog: ConditionCatalog,
        race_params: RaceParameters,
        whole_course: RegionList,
    }

    fn prereqs() -> Prereqs {
        let course = test_course();
        let whole_course = test_whole_course(&course);
        Prereqs {
            course,
            catalog: build_catalog(),
            race_params: test_race_params(),
            whole_course,
        }
    }

    fn prepare_ctx<'a>(pre: &'a Prereqs, parser: &'a ConditionParser<'a>) -> PrepareContext<'a> {
        PrepareContext {
            course: &pre.course,
            base_speed: 20.0 - (pre.course.distance - 2000.0) / 1000.0,
            condition_resolution: ConditionResolution::Dynamic,
            pos_keep_end_multiplier: 3.0,
            race_params: &pre.race_params,
            whole_course: &pre.whole_course,
            parser,
            skill_samples: 4,
            round_iteration: 0,
        }
    }

    fn prepared(strategy: Strategy) -> (Runner, CourseData) {
        let pre = prereqs();
        let parser = ConditionParser::new(&pre.catalog);
        let ctx = prepare_ctx(&pre, &parser);
        let mut r = test_runner(0, strategy);
        r.on_prepare(Box::new(Xoshiro256StarStar::from_u64_seed(42)), &ctx);
        (r, pre.course.clone())
    }

    fn update_ctx(course: &CourseData) -> UpdateContext<'_> {
        UpdateContext {
            base_speed: 20.0 - (course.distance - 2000.0) / 1000.0,
            accumulated_time: 0.0,
            course,
        }
    }

    /// Benign field inputs mirroring the previous single-runner resolution
    /// (Normal mode, empty field): not blocked, not overtaking, coordinated
    /// dueling, no pacer, at-gate skill view.
    fn test_field_inputs(field: &FieldView) -> FieldInputs<'_> {
        FieldInputs {
            side_blocked: false,
            front_block: None,
            overtaking: false,
            lane_neighbors: None,
            dueling: DuelingInput::Coordinated,
            position_keep: PositionKeepContext {
                position_keep_mode: 0,
                num_runners: 1,
                field_size: 1,
                pacer_position: None,
                pacer_strategy: None,
                pacer_is_self: false,
                second_place_position: None,
                backward_strategy_runner_ahead: false,
                only_front_runner: true,
            },
            skill_triggers: SkillTriggerInputs { field },
        }
    }

    #[test]
    fn on_prepare_seeds_physics_fields() {
        let (r, _) = prepared(Strategy::PaceChaser);
        // Phase tracking.
        assert_eq!(r.phase, Phase::EarlyRace);
        assert!(r.next_phase_transition > 0.0);
        // Movement state.
        assert_eq!(r.current_speed, 3.0);
        assert!(r.start_dash);
        assert!(r.start_delay >= 0.0 && r.start_delay <= 0.1);
        // Speed calcs.
        assert_eq!(r.base_target_speed_per_phase.len(), 3);
        assert!(r.last_spurt_speed > 0.0);
        assert!(r.min_speed > 0.0);
        assert_eq!(r.section_modifiers.len(), 25);
        // Base accelerations cached.
        assert!(r.base_accelerations.iter().all(|&a| a > 0.0));
        // Conditions registered (read directly from the runner's state).
        let condition_value = |name: &str| -> i32 {
            r.condition_values.get(name).copied().unwrap_or_else(|| {
                r.conditions
                    .get(name)
                    .map_or(0, |condition| condition.value_on_start())
            })
        };
        assert_eq!(condition_value("blocked_side"), 1);
        assert_eq!(condition_value("overtake"), 0);
    }

    #[test]
    fn runner_advances_forward_each_tick() {
        let (mut r, course) = prepared(Strategy::PaceChaser);
        let field = FieldView::at_gate();
        let ctx = update_ctx(&course);
        let fi = test_field_inputs(&field);
        let start = r.position;
        for _ in 0..200 {
            r.on_update(1.0 / 15.0, &fi, &ctx);
        }
        assert!(r.position > start);
        assert!(r.current_speed > 3.0);
    }

    #[test]
    fn start_dash_caps_speed_then_releases() {
        let (mut r, course) = prepared(Strategy::FrontRunner);
        let field = FieldView::at_gate();
        let ctx = update_ctx(&course);
        let fi = test_field_inputs(&field);
        // Run until start dash ends.
        let mut released = false;
        for _ in 0..500 {
            r.on_update(1.0 / 15.0, &fi, &ctx);
            if !r.start_dash {
                released = true;
                break;
            }
        }
        assert!(released);
        assert!(r.current_speed >= 0.85 * ctx.base_speed - 1e-6);
    }

    #[test]
    fn phase_advances_with_position() {
        let (mut r, _) = prepared(Strategy::PaceChaser);
        r.position = r.next_phase_transition + 1.0;
        r.update_phase(2400.0);
        assert_eq!(r.phase, Phase::MidRace);
    }

    #[test]
    fn hills_enter_and_exit() {
        let (mut r, _) = prepared(Strategy::PaceChaser);
        r.hills = vec![Hill {
            start: 100.0,
            end: 200.0,
            slope: 50.0,
        }];
        r.current_hill_index = -1;
        r.next_hill_to_check = 0;
        r.position = 150.0;
        r.update_hills();
        assert_eq!(r.current_hill_index, 0);
        assert_eq!(r.slope_per, 50.0);
        r.position = 250.0;
        r.update_hills();
        assert_eq!(r.current_hill_index, -1);
        assert_eq!(r.slope_per, 0.0);
    }

    #[test]
    fn first_position_coordinator_marks_one_leader() {
        let pre = prereqs();
        let parser = ConditionParser::new(&pre.catalog);
        let ctx = prepare_ctx(&pre, &parser);
        let course = &pre.course;
        let mut runners: Vec<Runner> = (0..3)
            .map(|i| {
                let mut r = test_runner(i, Strategy::PaceChaser);
                r.on_prepare(Box::new(Xoshiro256StarStar::from_u32_seed(i)), &ctx);
                r
            })
            .collect();
        runners[1].position = course.distance * 0.7;
        update_first_position_in_late_race(&mut runners, course.distance);
        let marked = runners
            .iter()
            .filter(|r| r.first_position_in_late_race)
            .count();
        assert_eq!(marked, 1);
        assert!(runners[1].first_position_in_late_race);
    }

    #[test]
    fn no_late_race_mark_before_two_thirds() {
        let pre = prereqs();
        let parser = ConditionParser::new(&pre.catalog);
        let ctx = prepare_ctx(&pre, &parser);
        let course = &pre.course;
        let mut runners: Vec<Runner> = (0..2)
            .map(|i| {
                let mut r = test_runner(i, Strategy::PaceChaser);
                r.on_prepare(Box::new(Xoshiro256StarStar::from_u32_seed(i)), &ctx);
                r
            })
            .collect();
        runners[0].position = course.distance * 0.5;
        update_first_position_in_late_race(&mut runners, course.distance);
        assert_eq!(
            runners
                .iter()
                .filter(|r| r.first_position_in_late_race)
                .count(),
            0
        );
    }
}
