//! Skill activation & effect application (t-015).
//!
//! Ports the skill half of `common/runner.ts` (`processSkillActivations`,
//! `activateSkill`, `activateRandomGoldSkill`, the wit check, targeted-effect
//! application) plus `buildSkillData` from `runner/runner.utils.ts` (adapted to
//! take a pre-resolved [`Skill`] instead of a service lookup).
//!
//! Dynamic `extra_condition` gates are evaluated through a
//! [`RunnerConditionView`] that combines the runner's self-state with the
//! per-frame [`FieldView`] (snapshot-derived field data the aggregate builds in
//! t-017). The view is constructed immutably and released before the `&mut self`
//! activation call, so the borrow checker is satisfied and resolution order is
//! irrelevant.

use crate::runner::lifecycle::PrepareContext;
use crate::runner::{Runner, UsedTargetedSkill};
use crate::shared_kernel::ids::SkillId;
use crate::shared_kernel::language::Strategy;
use crate::shared_kernel::math::Timer;
use crate::shared_kernel::params::{RaceParameters, StatLine};
use crate::shared_kernel::region::{Region, RegionList};
use crate::skills::activation::ActivationSamplePolicy;
use crate::skills::condition::dynamic::{
    eval_dynamic, ActiveRunner, DynamicCondition, RunnerSnapshot as DynRunnerSnapshot, RunnerView,
};
use crate::skills::condition::language::ConditionParser;
use crate::skills::condition::{ApplyParams, ConditionResolution, SkillEvalRunner};
use crate::skills::debuff::{get_external_debuff_effects, is_emittable_external_effect};
use crate::skills::effect::{SkillRarity, SkillType};
use crate::skills::model::{
    build_skill_effects, ActiveSkill, ActiveTargetedSkill, EmittedDebuff, PendingSkill,
    PendingTargetedSkill, ResolvedSkillEffect, Skill, SkillEffectSpec, SkillTrigger,
    TargetedSkillOrigin,
};
use crate::skills::recovery::resolve_effect_modifier;

/// Snapshot-derived field data dynamic skill conditions read through the
/// [`RunnerView`] seam. Built once per frame by the aggregate (t-017).
#[derive(Debug, Clone, Default)]
pub struct FieldView {
    /// This runner's current finishing order (1-based), if assigned.
    pub self_order: Option<i64>,
    /// This runner's previous-tick order, if assigned.
    pub self_previous_order: Option<i64>,
    /// Number of active runners in the field.
    pub num_umas: i64,
    /// The leader's position in meters, if known.
    pub leader_position: Option<f64>,
    /// Snapshots of every *other* active runner.
    pub other_snapshots: Vec<DynRunnerSnapshot>,
    /// Live state of every active runner (including self).
    pub active_runners: Vec<ActiveRunner>,
}

impl FieldView {
    /// The trivial field view used at the gate (no field resolved yet).
    pub fn at_gate() -> Self {
        FieldView::default()
    }
}

/// A read-only [`RunnerView`] combining a runner's self-state with the per-frame
/// [`FieldView`]. The anti-corruption bridge between the racing `Runner` and the
/// skills condition language.
pub struct RunnerConditionView<'a> {
    runner: &'a Runner,
    field: &'a FieldView,
}

impl RunnerView for RunnerConditionView<'_> {
    fn accumulate_time(&self) -> f64 {
        self.runner.accumulate_time.t
    }
    fn skills_activated_count(&self) -> i64 {
        self.runner.skills_activated_count
    }
    fn skills_activated_in_phase(&self, phase: usize) -> i64 {
        self.runner
            .skills_activated_phase_map
            .get(phase)
            .copied()
            .unwrap_or(0)
    }
    fn skills_activated_half_race(&self, half: usize) -> i64 {
        self.runner
            .skills_activated_half_race_map
            .get(half)
            .copied()
            .unwrap_or(0)
    }
    fn heals_activated_count(&self) -> i64 {
        self.runner.heals_activated_count
    }
    fn health_ratio_remaining(&self) -> f64 {
        self.runner.health_policy.health_ratio_remaining()
    }
    fn has_remaining_health(&self) -> bool {
        self.runner.health_policy.has_remaining_health()
    }
    fn has_used_skill(&self, skill_id: &str) -> bool {
        self.runner.used_skills.contains(skill_id)
    }
    fn start_delay(&self) -> f64 {
        self.runner.start_delay
    }
    fn is_last_spurt(&self) -> bool {
        self.runner.is_last_spurt
    }
    fn last_spurt_transition(&self) -> f64 {
        self.runner.last_spurt_transition
    }
    fn gate(&self) -> i64 {
        self.runner.gate
    }
    fn random_lot(&self) -> i64 {
        self.runner.random_lot
    }
    fn position(&self) -> f64 {
        self.runner.position
    }
    fn current_lane(&self) -> f64 {
        self.runner.current_lane
    }
    fn current_speed(&self) -> f64 {
        self.runner.current_speed
    }
    fn lane_change_speed(&self) -> f64 {
        self.runner.lane_change_speed
    }
    fn horse_lane(&self) -> f64 {
        self.runner.horse_lane
    }
    fn section_length(&self) -> f64 {
        self.runner.section_length
    }
    fn course_distance(&self) -> f64 {
        self.runner.course_distance
    }
    fn phase(&self) -> i64 {
        self.runner.phase.index() as i64
    }
    fn strategy(&self) -> Option<Strategy> {
        Some(self.runner.strategy)
    }
    fn is_rushed(&self) -> bool {
        self.runner.is_rushed
    }
    fn is_dueling(&self) -> bool {
        self.runner.is_dueling
    }
    fn current_order(&self) -> Option<i64> {
        self.field.self_order
    }
    fn previous_order(&self) -> Option<i64> {
        self.field.self_previous_order
    }
    fn num_umas(&self) -> i64 {
        self.field.num_umas
    }
    fn leader_position(&self) -> Option<f64> {
        self.field.leader_position
    }
    fn other_snapshots(&self) -> Vec<DynRunnerSnapshot> {
        self.field.other_snapshots.clone()
    }
    fn active_runners(&self) -> Vec<ActiveRunner> {
        self.field.active_runners.clone()
    }
}

/// Inputs to [`build_skill_data`]: a pre-resolved skill plus the static
/// condition-evaluation context.
pub struct BuildSkillDataParams<'a> {
    /// Static view of the runner (base stats / strategy / mood).
    pub runner: &'a SkillEvalRunner,
    /// Race-wide parameters.
    pub race_params: &'a RaceParameters,
    /// The course being raced.
    pub course: &'a crate::course::model::CourseData,
    /// The whole course as a region list.
    pub whole_course: &'a RegionList,
    /// The condition parser (bound to the static catalog).
    pub parser: &'a ConditionParser<'a>,
    /// The pre-resolved skill.
    pub skill: &'a Skill,
    /// Whether to keep triggers whose effect list is empty.
    pub ignore_null_effects: bool,
    /// Engine-supplied condition-resolution strategy (dynamic vs static).
    pub resolution: ConditionResolution,
}

/// Build the [`SkillTrigger`]s for a pre-resolved skill.
///
/// Port of `buildSkillData` (minus the service lookup / simulatable guard, which
/// the data layer performs upstream). Unparseable conditions yield an empty
/// result rather than panicking.
pub fn build_skill_data(params: &BuildSkillDataParams<'_>) -> Vec<SkillTrigger> {
    let skill = params.skill;
    let mut extra = params.race_params.clone();
    extra.skill_id = Some(skill.skill_id.clone());

    let mut triggers: Vec<SkillTrigger> = Vec::new();

    for alt in &skill.alternatives {
        if alt.condition.is_empty() {
            continue;
        }

        let mut full = params.whole_course.clone();

        // An empty precondition string means "no precondition" (TS treats it as
        // falsy in `if (skillAlternative.precondition)`). Skipping it is required
        // for skills whose data carries `precondition: ""` (e.g. all_corner_random
        // / rotation greens), which otherwise fail to parse and never activate.
        if let Some(precondition) = alt.precondition.as_deref().filter(|p| !p.is_empty()) {
            let Ok(parsed_pre) = params.parser.parse(precondition) else {
                return Vec::new();
            };
            let pre_params = ApplyParams {
                regions: params.whole_course.clone(),
                course: params.course,
                runner: params.runner,
                extra: &extra,
                resolution: params.resolution,
            };
            let Ok((pre_regions, _)) = parsed_pre.apply(&pre_params) else {
                return Vec::new();
            };
            if pre_regions.0.is_empty() {
                continue;
            }
            let Some(last) = params.whole_course.last() else {
                continue;
            };
            let bounds = Region::new(pre_regions.0[0].start, last.end);
            full = full.rmap(|r| r.intersect(&bounds));
        }

        let Ok(parsed_op) = params.parser.parse(&alt.condition) else {
            return Vec::new();
        };
        let apply_params = ApplyParams {
            regions: full,
            course: params.course,
            runner: params.runner,
            extra: &extra,
            resolution: params.resolution,
        };
        let Ok((regions, extra_condition)) = parsed_op.apply(&apply_params) else {
            return Vec::new();
        };
        if regions.0.is_empty() {
            continue;
        }

        if !triggers.is_empty() && !condition_allows_second_trigger(&alt.condition) {
            continue;
        }

        let effects = build_skill_effects(alt);
        if !effects.is_empty() || params.ignore_null_effects {
            triggers.push(SkillTrigger {
                skill_id: skill.skill_id.clone(),
                rarity: skill.rarity,
                tags: skill.tags.clone(),
                sample_policy: parsed_op.sample_policy(),
                regions,
                effects,
                extra_condition,
                target_strategy: derive_target_strategy(&alt.condition),
            });
        }
    }

    if !triggers.is_empty() {
        return triggers;
    }

    // Fallback: place the first alternative after the course end with a
    // constantly-false dynamic condition (summer Goldship unique edge case).
    let Some(first) = skill.alternatives.first() else {
        return Vec::new();
    };
    let effects = build_skill_effects(first);
    if effects.is_empty() && !params.ignore_null_effects {
        return Vec::new();
    }
    let mut after_end = RegionList::new();
    after_end.push(Region::new(9999.0, 9999.0));
    vec![SkillTrigger {
        skill_id: skill.skill_id.clone(),
        rarity: skill.rarity,
        tags: skill.tags.clone(),
        sample_policy: ActivationSamplePolicy::Immediate,
        regions: after_end,
        effects,
        extra_condition: Some(DynamicCondition::new(|_| false)),
        target_strategy: None,
    }]
}

/// Whether a second trigger may be placed for a skill (only when the condition
/// explicitly references the multi-trigger tokens).
fn condition_allows_second_trigger(condition: &str) -> bool {
    condition.contains("is_activate_other_skill_detail") || condition.contains("is_used_skill_id")
}

/// Derive the running style a strategy-targeted external debuff hits from its
/// activation condition. The effect data is identical across each family, so the
/// only signal for *which* strategy is hit is a running-style token in the
/// condition: `running_style_count_<style>_otherself` for the *Hesitant*
/// (`EnemyStrategy`) family, or `running_style_temptation_opponent_count_<style>`
/// for the *Frenzied* (`KakariStrategy`) family. Returns `None` when the
/// condition names no such style.
fn derive_target_strategy(condition: &str) -> Option<Strategy> {
    use crate::shared_kernel::language::Strategy;
    if condition.contains("running_style_count_nige_otherself")
        || condition.contains("running_style_temptation_opponent_count_nige")
    {
        Some(Strategy::FrontRunner)
    } else if condition.contains("running_style_count_senko_otherself")
        || condition.contains("running_style_temptation_opponent_count_senko")
    {
        Some(Strategy::PaceChaser)
    } else if condition.contains("running_style_count_sashi_otherself")
        || condition.contains("running_style_temptation_opponent_count_sashi")
    {
        Some(Strategy::LateSurger)
    } else if condition.contains("running_style_count_oikomi_otherself")
        || condition.contains("running_style_temptation_opponent_count_oikomi")
    {
        Some(Strategy::EndCloser)
    } else {
        None
    }
}

impl Runner {
    /// Reset and rebuild the skill-tracking state for a fresh round.
    ///
    /// Port of `initializeSkillTracking` (+ `initializeTargetedSkillTracking`).
    pub(crate) fn initialize_skill_tracking(&mut self, ctx: &PrepareContext<'_>) {
        self.target_speed_skills_active.clear();
        self.current_speed_skills_active.clear();
        self.acceleration_skills_active.clear();
        self.lane_movement_skills_active.clear();
        self.change_lane_skills_active.clear();
        self.targeted_target_speed_active.clear();
        self.targeted_current_speed_active.clear();
        self.targeted_acceleration_active.clear();
        self.targeted_lane_movement_skills_active.clear();
        self.targeted_change_lane_skills_active.clear();

        self.skills_activated_count = 0;
        self.skills_activated_phase_map = [0; 4];
        self.skills_activated_half_race_map = [0; 2];
        self.heals_activated_count = 0;
        self.used_skills.clear();
        self.activated_ledger.clear();
        self.activated_advantage_effect_types = 0;
        self.used_targeted_skills.clear();
        self.emitted_debuffs.clear();
        self.pending_skill_removal.clear();
        self.pending_skills.clear();
        self.pending_targeted_skills.clear();

        let eval_runner = self.skill_eval_runner();
        let skills = std::mem::take(&mut self.skills);
        let mut pending: Vec<PendingSkill> = Vec::new();
        let mut forced_bypass_granted: std::collections::HashSet<String> =
            std::collections::HashSet::new();
        for skill in &skills {
            let triggers = build_skill_data(&BuildSkillDataParams {
                runner: &eval_runner,
                race_params: ctx.race_params,
                course: ctx.course,
                whole_course: ctx.whole_course,
                parser: ctx.parser,
                skill,
                ignore_null_effects: false,
                resolution: ctx.condition_resolution,
            });
            for trigger in triggers {
                let base = trigger.skill_id.base().to_owned();
                let forced_pos = self.forced_positions.get(&base).copied();
                // A forced skill activates unconditionally at its position:
                // only the first alternative's trigger gets the bypass so
                // mutually exclusive alternatives cannot both fire there.
                let forced = forced_pos.is_some() && forced_bypass_granted.insert(base);
                let policy = match forced_pos {
                    Some(pos) => ActivationSamplePolicy::Fixed(pos),
                    None => trigger.sample_policy,
                };
                let samples =
                    policy.sample(&trigger.regions, ctx.skill_samples, &mut *self.skill_rng);
                if samples.is_empty() {
                    continue;
                }
                let trigger_region = samples[ctx.round_iteration % samples.len()];
                pending.push(PendingSkill {
                    skill_id: trigger.skill_id,
                    rarity: trigger.rarity,
                    tags: trigger.tags,
                    trigger: trigger_region,
                    effects: trigger.effects,
                    extra_condition: if forced {
                        None
                    } else {
                        trigger.extra_condition
                    },
                    target_strategy: trigger.target_strategy,
                    forced,
                });
            }
        }

        // A forced skill whose static conditions produced no trigger on this
        // course/run must still fire: the user scripted "this skill activates
        // here", the same contract as injected debuffs. Synthesize a pending
        // entry from the first alternative that yields modeled effects.
        for skill in &skills {
            let base = skill.skill_id.base().to_owned();
            let Some(&pos) = self.forced_positions.get(&base) else {
                continue;
            };
            if forced_bypass_granted.contains(&base) {
                continue;
            }
            for alt in &skill.alternatives {
                let effects = build_skill_effects(alt);
                if effects.is_empty() {
                    continue;
                }
                forced_bypass_granted.insert(base);
                pending.push(PendingSkill {
                    skill_id: skill.skill_id.clone(),
                    rarity: skill.rarity,
                    tags: skill.tags.clone(),
                    trigger: Region::new(pos, pos + 10.0),
                    effects,
                    extra_condition: None,
                    target_strategy: derive_target_strategy(&alt.condition),
                    forced: true,
                });
                break;
            }
        }
        self.skills = skills;
        self.pending_skills = pending;

        self.initialize_targeted_skill_tracking(&eval_runner, ctx);
    }

    /// Port of `initializeTargetedSkillTracking`: resolve each injected debuff to
    /// its external-debuff effects and queue a fixed-position
    /// [`PendingTargetedSkill`]. Injected debuffs are pre-resolved [`Skill`]s
    /// (the data layer performs the service lookup upstream).
    fn initialize_targeted_skill_tracking(
        &mut self,
        eval_runner: &SkillEvalRunner,
        ctx: &PrepareContext<'_>,
    ) {
        if self.injected_debuffs.is_empty() {
            return;
        }
        let debuffs = std::mem::take(&mut self.injected_debuffs);
        for debuff in &debuffs {
            let triggers = build_skill_data(&BuildSkillDataParams {
                runner: eval_runner,
                race_params: ctx.race_params,
                course: ctx.course,
                whole_course: ctx.whole_course,
                parser: ctx.parser,
                skill: &debuff.skill,
                ignore_null_effects: false,
                resolution: ctx.condition_resolution,
            });
            for trigger in triggers {
                let external: Vec<SkillEffectSpec> = get_external_debuff_effects(&trigger.effects)
                    .into_iter()
                    .copied()
                    .collect();
                if external.is_empty() {
                    continue;
                }
                let policy = ActivationSamplePolicy::Fixed(debuff.position);
                let samples =
                    policy.sample(&trigger.regions, ctx.skill_samples, &mut *self.skill_rng);
                if samples.is_empty() {
                    continue;
                }
                let trigger_region = samples[ctx.round_iteration % samples.len()];
                self.pending_targeted_skills.push(PendingTargetedSkill {
                    skill_id: trigger.skill_id,
                    origin: TargetedSkillOrigin::Injection,
                    source_runner_id: None,
                    trigger: trigger_region,
                    effects: external,
                });
            }
        }
        self.injected_debuffs = debuffs;
    }

    fn skill_eval_runner(&self) -> SkillEvalRunner {
        SkillEvalRunner {
            base_stats: StatLine {
                speed: self.base_stats.speed.round() as i32,
                stamina: self.base_stats.stamina.round() as i32,
                power: self.base_stats.power.round() as i32,
                guts: self.base_stats.guts.round() as i32,
                wit: self.base_stats.wit.round() as i32,
            },
            strategy: self.strategy,
            mood: self.mood,
            popularity: self.popularity,
        }
    }

    /// Activate green (gate) skills at the start of the round.
    pub(crate) fn activate_gate_skills(&mut self, course_distance: f64) {
        let field = FieldView::at_gate();
        self.process_skill_activations(&field, course_distance);
    }

    /// Process self-skill activations for this tick.
    pub(crate) fn process_skill_activations(&mut self, field: &FieldView, course_distance: f64) {
        self.cleanup_expired_self_skills();

        let mut i = self.pending_skills.len();
        while i > 0 {
            i -= 1;
            if i >= self.pending_skills.len() {
                continue;
            }
            let (trigger, skill_id, forced) = {
                let s = &self.pending_skills[i];
                (s.trigger, s.skill_id.0.clone(), s.forced)
            };

            if self.position >= trigger.end || self.pending_skill_removal.contains(&skill_id) {
                self.pending_skills.remove(i);
                self.pending_skill_removal.remove(&skill_id);
                continue;
            }

            if self.position >= trigger.start && (forced || self.pending_extra_passes(i, field)) {
                let skip = forced || self.should_skip_wit_check_at(i);
                if skip || self.do_wit_check() {
                    let skill = self.pending_skills[i].clone();
                    self.activate_skill(&skill, course_distance);
                }
                self.pending_skills.remove(i);
            }
        }
    }

    fn cleanup_expired_self_skills(&mut self) {
        for modifier in drain_expired(&mut self.target_speed_skills_active) {
            self.modifiers.target_speed.add(-modifier);
        }
        let mut one_frame = 0.0;
        let mut removed: Vec<(f64, bool)> = Vec::new();
        self.current_speed_skills_active.retain(|s| {
            if s.duration_timer.t >= 0.0 {
                removed.push((s.modifier, s.natural_deceleration));
                false
            } else {
                true
            }
        });
        for (modifier, natural) in removed {
            self.modifiers.current_speed.add(-modifier);
            if natural {
                one_frame += modifier;
            }
        }
        self.modifiers.one_frame_accel += one_frame;
        for modifier in drain_expired(&mut self.acceleration_skills_active) {
            self.modifiers.accel.add(-modifier);
        }
        self.lane_movement_skills_active
            .retain(|s| s.duration_timer.t < 0.0);
        self.change_lane_skills_active
            .retain(|s| s.duration_timer.t < 0.0);
    }

    fn pending_extra_passes(&self, idx: usize, field: &FieldView) -> bool {
        let skill = &self.pending_skills[idx];
        let view = RunnerConditionView {
            runner: self,
            field,
        };
        eval_dynamic(&skill.extra_condition, &view)
    }

    fn should_skip_wit_check_at(&self, idx: usize) -> bool {
        self.should_skip_wit_check(&self.pending_skills[idx])
    }

    fn should_skip_wit_check(&self, skill: &PendingSkill) -> bool {
        if !self.wit_checks_enabled {
            return true;
        }
        if let Some(first) = skill.effects.first() {
            let type_id = first.effect_type as i32;
            if (1..=6).contains(&type_id) {
                return true;
            }
        }
        skill.rarity == SkillRarity::Unique
    }

    fn do_wit_check(&mut self) -> bool {
        let wit = self.base_stats.wit;
        let roll = self.wit_rng.random();
        let threshold = crate::readouts::skill_activation_chance(wit);
        roll <= threshold
    }

    /// Resolve one effect spec into a concrete [`ResolvedSkillEffect`] against
    /// this runner's state, applying its value-scaling policy exactly once. The
    /// Recovery drain override is a Recovery-specific pre-step that consumes no
    /// RNG roll (see [`resolve_effect_modifier`]).
    fn resolve_effect(
        &mut self,
        base_skill_id: &str,
        spec: &SkillEffectSpec,
    ) -> ResolvedSkillEffect {
        let override_value = self.stamina_drain_overrides.get(base_skill_id).copied();
        let activated_green_count = self.activated_ledger.activated_green_count();
        let modifier = resolve_effect_modifier(
            spec,
            Some(&mut *self.skill_rng),
            override_value,
            activated_green_count,
        )
        .unwrap_or(0.0);
        ResolvedSkillEffect {
            target: spec.target,
            effect_type: spec.effect_type,
            base_duration: spec.base_duration,
            modifier,
        }
    }

    fn activate_skill(&mut self, skill: &PendingSkill, course_distance: f64) {
        let mut specs = skill.effects.clone();
        specs.sort_by_key(|e| i32::from(e.effect_type as i32 == 42));
        let base_skill_id = skill.skill_id.base().to_owned();

        for spec in &specs {
            // Resolve the effect's value-scaling policy exactly once against the
            // caster's state, before self-application or external-debuff routing.
            let resolved = self.resolve_effect(&base_skill_id, spec);

            // External debuffs target other runners (e.g. Wild Wind / Speed
            // Eater bundle a self-buff with an opponent-facing Current Speed
            // debuff; the Hesitant family debuffs a whole enemy strategy). They
            // must never land on the caster: emit the already-resolved effect to
            // the per-frame outbox so the race aggregate's
            // `coordinate_external_debuffs` pass routes it onto the target
            // runners via `receive_targeted_effect`. The caster resolves the
            // value here so the receiver never re-resolves it.
            if is_emittable_external_effect(&resolved) {
                self.emitted_debuffs.push(EmittedDebuff {
                    skill_id: skill.skill_id.clone(),
                    effect: resolved,
                    target: resolved.target,
                    target_strategy: skill.target_strategy,
                });
                continue;
            }
            // Record positive self-buffs (resolved value) so opponents can react
            // via is_other_character_activate_advantage_skill (arg = SkillType).
            if resolved.modifier > 0.0 {
                let t = resolved.effect_type as i64;
                if (0..64).contains(&t) {
                    self.activated_advantage_effect_types |= 1u64 << t;
                }
            }
            let scaling = if skill.rarity == SkillRarity::Evolution {
                self.modifiers.special_skill_duration_scaling
            } else {
                1.0
            };
            let scaled_duration = resolved.base_duration * (course_distance / 1000.0) * scaling;
            self.apply_self_effect(skill, &resolved, scaled_duration);
        }

        let half_race = usize::from(self.position >= course_distance / 2.0);
        self.skills_activated_half_race_map[half_race] += 1;
        self.skills_activated_phase_map[self.phase.index()] += 1;
        self.skills_activated_count += 1;
        self.used_skills.insert(skill.skill_id.0.clone());
        // Record only after a successful activation so caster-context scaling
        // (usage 14) counts greens that actually fired this round.
        self.activated_ledger.record(&base_skill_id, &skill.tags);
    }

    fn apply_self_effect(
        &mut self,
        skill: &PendingSkill,
        effect: &ResolvedSkillEffect,
        duration: f64,
    ) {
        match effect.effect_type {
            SkillType::Noop => {}
            SkillType::SpeedUp => {
                self.adjusted_stats.speed = (self.adjusted_stats.speed + effect.modifier).max(1.0);
            }
            SkillType::StaminaUp => {
                self.adjusted_stats.stamina =
                    (self.adjusted_stats.stamina + effect.modifier).max(1.0);
                self.base_stats.stamina = (self.base_stats.stamina + effect.modifier).max(1.0);
            }
            SkillType::PowerUp => {
                self.adjusted_stats.power = (self.adjusted_stats.power + effect.modifier).max(1.0);
            }
            SkillType::GutsUp => {
                self.adjusted_stats.guts = (self.adjusted_stats.guts + effect.modifier).max(1.0);
            }
            SkillType::WisdomUp => {
                self.adjusted_stats.wit = (self.adjusted_stats.wit + effect.modifier).max(1.0);
            }
            SkillType::ChangeStrategy => self.position_keep_strategy = Strategy::Runaway,
            // Read pre-race off the pending queue by `rushed_chance` (the rushed
            // roll runs before gate skills fire), so activation is a no-op.
            SkillType::RushedChance => {}
            // Frenzied (type 13) only ever targets opponents (KakariStrategy);
            // a self-application is a no-op.
            SkillType::RushedDuration => {}
            SkillType::MultiplyStartDelay => self.start_delay *= effect.modifier,
            SkillType::SetStartDelay => self.start_delay = effect.modifier,
            SkillType::TargetSpeed => {
                self.modifiers.target_speed.add(effect.modifier);
                self.target_speed_skills_active
                    .push(active_skill(skill, effect, duration, false));
            }
            SkillType::Accel => {
                self.modifiers.accel.add(effect.modifier);
                self.acceleration_skills_active
                    .push(active_skill(skill, effect, duration, false));
            }
            SkillType::LaneMovementSpeed => {
                self.lane_movement_skills_active
                    .push(active_skill(skill, effect, duration, false));
            }
            SkillType::CurrentSpeed | SkillType::CurrentSpeedWithNaturalDeceleration => {
                self.modifiers.current_speed.add(effect.modifier);
                let natural = effect.effect_type == SkillType::CurrentSpeedWithNaturalDeceleration;
                self.current_speed_skills_active
                    .push(active_skill(skill, effect, duration, natural));
            }
            SkillType::Recovery => {
                if effect.modifier > 0.0 {
                    self.heals_activated_count += 1;
                }
                self.health_policy.recover(effect.modifier);
                if self.phase.index() >= 2 && !self.is_last_spurt {
                    self.force_last_spurt_check();
                }
            }
            SkillType::ActivateRandomGold => {
                self.activate_random_gold_skill(effect.modifier as usize, duration);
            }
            SkillType::ExtendEvolvedDuration => {
                self.modifiers.special_skill_duration_scaling = effect.modifier;
            }
            SkillType::ChangeLane => {
                self.change_lane_skills_active
                    .push(active_skill(skill, effect, duration, false));
            }
        }
    }

    fn activate_random_gold_skill(&mut self, count: usize, course_distance: f64) {
        let mut gold_indices: Vec<usize> = self
            .pending_skills
            .iter()
            .enumerate()
            .filter(|(_, skill)| {
                let gold = matches!(skill.rarity, SkillRarity::Gold | SkillRarity::Evolution);
                gold && skill.effects.iter().all(|e| (e.effect_type as i32) > 5)
            })
            .map(|(idx, _)| idx)
            .collect();

        let mut i = gold_indices.len();
        while i > 0 {
            i -= 1;
            let j = self.force_skill_activator_rng.uniform(i as u32 + 1) as usize;
            gold_indices.swap(i, j);
        }

        for &idx in gold_indices.iter().take(count) {
            let skill = self.pending_skills[idx].clone();
            self.activate_skill(&skill, course_distance);
            self.pending_skill_removal.insert(skill.skill_id.0.clone());
        }
    }

    /// Process targeted (injected / cross-runner) skill activations this tick.
    pub(crate) fn process_targeted_skill_activations(&mut self, course_distance: f64) {
        self.cleanup_expired_targeted_skills();

        let mut i = self.pending_targeted_skills.len();
        while i > 0 {
            i -= 1;
            if i >= self.pending_targeted_skills.len() {
                continue;
            }
            let trigger = self.pending_targeted_skills[i].trigger;
            if self.position >= trigger.end {
                self.pending_targeted_skills.remove(i);
                continue;
            }
            if self.position >= trigger.start {
                let skill = self.pending_targeted_skills[i].clone();
                self.apply_targeted_effect(&skill, course_distance);
                self.pending_targeted_skills.remove(i);
            }
        }
    }

    fn cleanup_expired_targeted_skills(&mut self) {
        for modifier in drain_expired_targeted(&mut self.targeted_target_speed_active) {
            self.modifiers.target_speed.add(-modifier);
        }
        let mut one_frame = 0.0;
        let mut removed: Vec<(f64, bool)> = Vec::new();
        self.targeted_current_speed_active.retain(|s| {
            if s.skill.duration_timer.t >= 0.0 {
                removed.push((s.skill.modifier, s.skill.natural_deceleration));
                false
            } else {
                true
            }
        });
        for (modifier, natural) in removed {
            self.modifiers.current_speed.add(-modifier);
            if natural {
                one_frame += modifier;
            }
        }
        self.modifiers.one_frame_accel += one_frame;
        for modifier in drain_expired_targeted(&mut self.targeted_acceleration_active) {
            self.modifiers.accel.add(-modifier);
        }
        self.targeted_lane_movement_skills_active
            .retain(|s| s.skill.duration_timer.t < 0.0);
        self.targeted_change_lane_skills_active
            .retain(|s| s.skill.duration_timer.t < 0.0);
    }

    /// Apply an **injected** targeted skill (from the debuff test harness, which
    /// has no caster). Injected effects are unresolved specs, so they are
    /// resolved receiver-locally here. Only caster-context policies (usage 14)
    /// are unsafe without a caster, and those are rejected at the injection DTO
    /// boundary before the race.
    fn apply_targeted_effect(&mut self, skill: &PendingTargetedSkill, course_distance: f64) {
        let mut specs = skill.effects.clone();
        specs.sort_by_key(|e| i32::from(e.effect_type as i32 == 42));
        let base_skill_id = skill.skill_id.base().to_owned();
        let meta = TargetedEffectMeta {
            skill_id: skill.skill_id.clone(),
            origin: skill.origin,
            source_runner_id: skill.source_runner_id,
        };

        for spec in &specs {
            let resolved = self.resolve_effect(&base_skill_id, spec);
            self.apply_resolved_targeted_effect(&meta, &resolved, course_distance);
        }
    }

    /// Record and apply one already-resolved targeted effect. Shared by the
    /// injected path (which resolves receiver-locally) and the cross-runner path
    /// (which receives values already resolved by the caster).
    fn apply_resolved_targeted_effect(
        &mut self,
        meta: &TargetedEffectMeta,
        effect: &ResolvedSkillEffect,
        course_distance: f64,
    ) {
        let scaled_duration = effect.base_duration * (course_distance / 1000.0);
        self.used_targeted_skills.push(UsedTargetedSkill {
            skill_id: meta.skill_id.clone(),
            position: self.position,
            effect_type: effect.effect_type,
            effect_target: effect.target,
        });
        self.apply_targeted_effect_kind(meta, effect, scaled_duration);
    }

    fn apply_targeted_effect_kind(
        &mut self,
        meta: &TargetedEffectMeta,
        effect: &ResolvedSkillEffect,
        duration: f64,
    ) {
        match effect.effect_type {
            SkillType::Noop | SkillType::ChangeStrategy | SkillType::RushedChance => {}
            // Frenzied family: worsen a rushed opponent by extending its
            // remaining rushed duration (modifier is +5.0s, already scaled).
            // Only meaningful while the target is currently rushed; the 12s
            // cap-based exit is delayed by the added time.
            SkillType::RushedDuration => {
                if self.is_rushed {
                    self.rushed_max_duration += effect.modifier;
                }
            }
            SkillType::SpeedUp => {
                self.adjusted_stats.speed = (self.adjusted_stats.speed + effect.modifier).max(1.0);
            }
            SkillType::StaminaUp => {
                self.adjusted_stats.stamina =
                    (self.adjusted_stats.stamina + effect.modifier).max(1.0);
                self.base_stats.stamina = (self.base_stats.stamina + effect.modifier).max(1.0);
            }
            SkillType::PowerUp => {
                self.adjusted_stats.power = (self.adjusted_stats.power + effect.modifier).max(1.0);
            }
            SkillType::GutsUp => {
                self.adjusted_stats.guts = (self.adjusted_stats.guts + effect.modifier).max(1.0);
            }
            SkillType::WisdomUp => {
                self.adjusted_stats.wit = (self.adjusted_stats.wit + effect.modifier).max(1.0);
            }
            SkillType::MultiplyStartDelay => self.start_delay *= effect.modifier,
            SkillType::SetStartDelay => self.start_delay = effect.modifier,
            SkillType::TargetSpeed => {
                self.modifiers.target_speed.add(effect.modifier);
                self.targeted_target_speed_active
                    .push(active_targeted(meta, effect, duration, false));
            }
            SkillType::Accel => {
                self.modifiers.accel.add(effect.modifier);
                self.targeted_acceleration_active
                    .push(active_targeted(meta, effect, duration, false));
            }
            SkillType::LaneMovementSpeed => {
                self.targeted_lane_movement_skills_active
                    .push(active_targeted(meta, effect, duration, false));
            }
            SkillType::CurrentSpeed | SkillType::CurrentSpeedWithNaturalDeceleration => {
                self.modifiers.current_speed.add(effect.modifier);
                let natural = effect.effect_type == SkillType::CurrentSpeedWithNaturalDeceleration;
                self.targeted_current_speed_active
                    .push(active_targeted(meta, effect, duration, natural));
            }
            SkillType::Recovery => {
                self.health_policy.recover(effect.modifier);
                if self.phase.index() >= 2 && !self.is_last_spurt {
                    self.force_last_spurt_check();
                }
            }
            SkillType::ActivateRandomGold | SkillType::ExtendEvolvedDuration => {}
            SkillType::ChangeLane => {
                self.targeted_change_lane_skills_active
                    .push(active_targeted(meta, effect, duration, false));
            }
        }
    }

    /// Entry point for a cross-runner targeted effect (routed by the aggregate).
    ///
    /// The effects arrive **already resolved by the caster** (see
    /// `Self::activate_skill`); the receiver must not re-resolve them, which is
    /// enforced by the [`ResolvedSkillEffect`] type.
    pub fn receive_targeted_effect(
        &mut self,
        skill_id: SkillId,
        effects: Vec<ResolvedSkillEffect>,
        source_runner_id: crate::shared_kernel::ids::RunnerId,
        course_distance: f64,
    ) {
        let meta = TargetedEffectMeta {
            skill_id,
            origin: TargetedSkillOrigin::Runner,
            source_runner_id: Some(source_runner_id),
        };
        let mut effects = effects;
        effects.sort_by_key(|e| i32::from(e.effect_type as i32 == 42));
        for resolved in &effects {
            self.apply_resolved_targeted_effect(&meta, resolved, course_distance);
        }
    }
}

/// Identity of a targeted-effect application, shared by the injected and
/// cross-runner paths so the per-effect application logic is written once.
struct TargetedEffectMeta {
    skill_id: SkillId,
    origin: TargetedSkillOrigin,
    source_runner_id: Option<crate::shared_kernel::ids::RunnerId>,
}

fn active_skill(
    skill: &PendingSkill,
    effect: &ResolvedSkillEffect,
    duration: f64,
    natural_deceleration: bool,
) -> ActiveSkill {
    ActiveSkill {
        skill_id: skill.skill_id.clone(),
        duration_timer: Timer::new(-duration),
        modifier: effect.modifier,
        effect_target: effect.target,
        effect_type: effect.effect_type,
        natural_deceleration,
    }
}

fn active_targeted(
    meta: &TargetedEffectMeta,
    effect: &ResolvedSkillEffect,
    duration: f64,
    natural_deceleration: bool,
) -> ActiveTargetedSkill {
    ActiveTargetedSkill {
        skill: ActiveSkill {
            skill_id: meta.skill_id.clone(),
            duration_timer: Timer::new(-duration),
            modifier: effect.modifier,
            effect_target: effect.target,
            effect_type: effect.effect_type,
            natural_deceleration,
        },
        origin: meta.origin,
        source_runner_id: meta.source_runner_id,
    }
}

/// Drain expired (timer ≥ 0) self active skills, returning their modifiers so the
/// caller can reverse each on the runner's Kahan accumulator.
fn drain_expired(skills: &mut Vec<ActiveSkill>) -> Vec<f64> {
    let mut removed = Vec::new();
    skills.retain(|s| {
        if s.duration_timer.t >= 0.0 {
            removed.push(s.modifier);
            false
        } else {
            true
        }
    });
    removed
}

/// Drain expired targeted active skills, returning their modifiers.
fn drain_expired_targeted(skills: &mut Vec<ActiveTargetedSkill>) -> Vec<f64> {
    let mut removed = Vec::new();
    skills.retain(|s| {
        if s.skill.duration_timer.t >= 0.0 {
            removed.push(s.skill.modifier);
            false
        } else {
            true
        }
    });
    removed
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runner::lifecycle::{CreateRunner, RunnerAptitudes};
    use crate::runner::test_support::{test_course, test_race_params, test_whole_course};
    use crate::shared_kernel::ids::{RunnerId, SkillId};
    use crate::shared_kernel::language::{Aptitude, GroundCondition, Mood, Strategy};
    use crate::shared_kernel::params::StatLine;
    use crate::shared_kernel::rng::Xoshiro256StarStar;
    use crate::skills::condition::catalog::build_catalog;
    use crate::skills::condition::language::ConditionParser;
    use crate::skills::effect::{SkillRarity, SkillTarget, SkillType};
    use crate::skills::model::{RawSkillEffect, Skill, SkillAlternative};
    use crate::stamina::policy::NoopStaminaPolicy;
    use std::collections::HashMap;

    fn eval_runner() -> SkillEvalRunner {
        SkillEvalRunner {
            base_stats: StatLine {
                speed: 1000,
                stamina: 1000,
                power: 1000,
                guts: 1000,
                wit: 800,
            },
            strategy: Strategy::PaceChaser,
            mood: Mood::Normal,
            popularity: 0,
        }
    }

    fn target_speed_skill(id: &str, rarity: SkillRarity, condition: &str) -> Skill {
        Skill {
            skill_id: SkillId::new(id),
            rarity,
            tags: vec![],
            alternatives: vec![SkillAlternative {
                base_duration: 30000.0,
                cooldown_time: None,
                condition: condition.to_owned(),
                precondition: None,
                effects: vec![RawSkillEffect {
                    modifier: 4500.0,
                    target: SkillTarget::SelfTarget,
                    effect_type: 27, // TargetSpeed
                    value_usage: None,
                    value_level_usage: None,
                    pre_applied_multiplier: None,
                }],
            }],
        }
    }

    /// A Savvy-shaped skill: Wisdom Up (type 5, modeled) bundled with a vision effect (type 8, unmodeled), gated on the Pace Chaser running style — the exact shape of real skill 201531 (Pace Chaser Savvy ◎).
    fn savvy_skill(id: &str) -> Skill {
        Skill {
            skill_id: SkillId::new(id),
            rarity: SkillRarity::White,
            tags: vec![],
            alternatives: vec![SkillAlternative {
                base_duration: -10000.0,
                cooldown_time: None,
                condition: "running_style==2".to_owned(),
                precondition: None,
                effects: vec![
                    RawSkillEffect {
                        modifier: 600000.0,
                        target: SkillTarget::SelfTarget,
                        effect_type: 5, // Wisdom Up (modeled)
                        value_usage: Some(1),
                        value_level_usage: Some(1),
                        pre_applied_multiplier: None,
                    },
                    RawSkillEffect {
                        modifier: 100000.0,
                        target: SkillTarget::SelfTarget,
                        effect_type: 8, // vision (unmodeled)
                        value_usage: Some(1),
                        value_level_usage: Some(1),
                        pre_applied_multiplier: None,
                    },
                ],
            }],
        }
    }

    fn runaway_skill(condition: &str) -> Skill {
        Skill {
            skill_id: SkillId::new("202051"),
            rarity: SkillRarity::Gold,
            tags: vec![101, 612],
            alternatives: vec![SkillAlternative {
                base_duration: -1.0,
                cooldown_time: Some(0.0),
                condition: condition.to_owned(),
                precondition: Some(String::new()),
                effects: vec![RawSkillEffect {
                    modifier: 0.0,
                    target: SkillTarget::SelfTarget,
                    effect_type: 6,
                    value_usage: Some(1),
                    value_level_usage: Some(1),
                    pre_applied_multiplier: None,
                }],
            }],
        }
    }

    fn build(skill: &Skill) -> Vec<SkillTrigger> {
        let course = test_course();
        let catalog = build_catalog();
        let parser = ConditionParser::new(&catalog);
        let rp = test_race_params();
        let wc = test_whole_course(&course);
        let eval = eval_runner();
        build_skill_data(&BuildSkillDataParams {
            runner: &eval,
            race_params: &rp,
            course: &course,
            whole_course: &wc,
            parser: &parser,
            skill,
            ignore_null_effects: false,
            resolution: ConditionResolution::Dynamic,
        })
    }

    #[test]
    fn build_skill_data_produces_trigger_for_phase_condition() {
        let skill = target_speed_skill("100001", SkillRarity::Gold, "phase>=2");
        let triggers = build(&skill);
        assert_eq!(triggers.len(), 1);
        assert!(!triggers[0].regions.0.is_empty());
        assert_eq!(triggers[0].effects[0].effect_type, SkillType::TargetSpeed);
        assert!(triggers[0].regions.0[0].start >= 1200.0);
    }

    #[test]
    fn empty_precondition_is_treated_as_none_and_still_activates() {
        // Regression (ADR-0004 Option-B bug #2): skills whose data carries
        // `precondition: ""` (e.g. all_corner_random / rotation greens) must treat
        // the empty string as "no precondition" and still produce a trigger — not
        // try to parse the empty string, fail, and silently never activate.
        let none_pre = target_speed_skill("200012", SkillRarity::Gold, "phase>=1");
        assert_eq!(
            build(&none_pre).len(),
            1,
            "baseline: no precondition activates"
        );

        let mut empty_pre = target_speed_skill("200012", SkillRarity::Gold, "phase>=1");
        empty_pre.alternatives[0].precondition = Some(String::new());
        let triggers = build(&empty_pre);
        assert_eq!(
            triggers.len(),
            1,
            "empty precondition must behave like no precondition, not suppress the trigger"
        );
        assert!(!triggers[0].regions.0.is_empty());
    }

    #[test]
    fn build_skill_data_keeps_full_regions_for_dynamic_condition() {
        // `is_lastspurt` does not narrow regions; it yields the whole course plus
        // a runtime gate (extra_condition).
        let skill = target_speed_skill("100002", SkillRarity::Gold, "is_lastspurt==1");
        let triggers = build(&skill);
        assert_eq!(triggers.len(), 1);
        assert!(!triggers[0].regions.0.is_empty());
        // Last-spurt portion of the course (>= half distance).
        assert!(triggers[0].regions.0[0].start >= 1200.0);
    }

    fn runner_with_skills(skills: Vec<Skill>) -> Runner {
        runner_with_skills_forced(skills, HashMap::new())
    }

    fn runner_with_skills_forced(
        skills: Vec<Skill>,
        forced_positions: HashMap<String, f64>,
    ) -> Runner {
        let props = CreateRunner {
            outfit_id: "100302".to_owned(),
            name: "Test".to_owned(),
            mood: Mood::Normal,
            strategy: Strategy::PaceChaser,
            popularity: 0,
            team: None,
            aptitudes: RunnerAptitudes {
                distance: Aptitude::A,
                strategy: Aptitude::A,
                surface: Aptitude::A,
            },
            stats: StatLine {
                speed: 1000,
                stamina: 1000,
                power: 1000,
                guts: 1000,
                wit: 800,
            },
            skills,
            forced_positions,
            injected_debuffs: vec![],
            forced_rushed_regions: vec![],
            forced_dueling_regions: vec![],
            forced_spot_struggle_regions: vec![],
            forced_rank: vec![],
            gate: None,
            forced_start_delay: None,
            forced_last_spurt_distance: None,
        };
        Runner::create(
            RunnerId(0),
            &test_course(),
            GroundCondition::Firm,
            props,
            Box::new(NoopStaminaPolicy),
            Box::new(Xoshiro256StarStar::from_u32_seed(1)),
        )
    }

    fn prepare(r: &mut Runner) {
        let course = test_course();
        let catalog = build_catalog();
        let parser = ConditionParser::new(&catalog);
        let rp = test_race_params();
        let wc = test_whole_course(&course);
        let ctx = PrepareContext {
            course: &course,
            base_speed: 19.6,
            condition_resolution: ConditionResolution::Dynamic,
            pos_keep_end_multiplier: 3.0,
            race_params: &rp,
            whole_course: &wc,
            parser: &parser,
            skill_samples: 4,
            round_iteration: 0,
        };
        r.on_prepare(Box::new(Xoshiro256StarStar::from_u64_seed(7)), &ctx);
    }

    /// The Copano Rickey (109801) matchup from the saved contested-compare
    /// scenario: `100981` (Luck Runs My Way, usage-14) plus three greens
    /// — Pace Chaser Savvy ○ (201532, tag 612), Collaborative Graded Races ○
    /// (202252, tag 606), Wet Conditions ○ (200162, tag 601).
    fn copano_rickey_full_skills() -> Vec<Skill> {
        let green = |id: &str, tags: Vec<i32>, cond: &str, effect_type: i32| Skill {
            skill_id: SkillId::new(id),
            rarity: SkillRarity::White,
            tags,
            alternatives: vec![SkillAlternative {
                base_duration: -10000.0,
                cooldown_time: Some(0.0),
                condition: cond.to_owned(),
                precondition: Some(String::new()),
                effects: vec![RawSkillEffect {
                    modifier: 400000.0,
                    target: SkillTarget::SelfTarget,
                    effect_type,
                    value_usage: Some(1),
                    value_level_usage: Some(1),
                    pre_applied_multiplier: None,
                }],
            }],
        };
        vec![
            // 100981 Luck Runs My Way: Direct Target Speed + usage-14 Target
            // Speed + usage-14 Acceleration.
            Skill {
                skill_id: SkillId::new("100981"),
                rarity: SkillRarity::Unique,
                tags: vec![401, 403],
                alternatives: vec![SkillAlternative {
                    base_duration: 50000.0,
                    cooldown_time: None,
                    condition: "phase_laterhalf_random==1".to_owned(),
                    precondition: Some(String::new()),
                    effects: vec![
                        RawSkillEffect {
                            modifier: 2500.0,
                            target: SkillTarget::SelfTarget,
                            effect_type: 27,
                            value_usage: Some(1),
                            value_level_usage: None,
                            pre_applied_multiplier: None,
                        },
                        RawSkillEffect {
                            modifier: 500.0,
                            target: SkillTarget::SelfTarget,
                            effect_type: 27,
                            value_usage: Some(14),
                            value_level_usage: None,
                            pre_applied_multiplier: None,
                        },
                        RawSkillEffect {
                            modifier: 500.0,
                            target: SkillTarget::SelfTarget,
                            effect_type: 31,
                            value_usage: Some(14),
                            value_level_usage: None,
                            pre_applied_multiplier: None,
                        },
                    ],
                }],
            },
            // 201532 Pace Chaser Savvy ○: Wisdom Up (green) + vision (unmodeled).
            Skill {
                skill_id: SkillId::new("201532"),
                rarity: SkillRarity::White,
                tags: vec![102, 405, 612],
                alternatives: vec![SkillAlternative {
                    base_duration: -10000.0,
                    cooldown_time: Some(0.0),
                    condition: "running_style==2".to_owned(),
                    precondition: Some(String::new()),
                    effects: vec![
                        RawSkillEffect {
                            modifier: 400000.0,
                            target: SkillTarget::SelfTarget,
                            effect_type: 5,
                            value_usage: Some(1),
                            value_level_usage: Some(1),
                            pre_applied_multiplier: None,
                        },
                        RawSkillEffect {
                            modifier: 50000.0,
                            target: SkillTarget::SelfTarget,
                            effect_type: 8,
                            value_usage: Some(1),
                            value_level_usage: Some(1),
                            pre_applied_multiplier: None,
                        },
                    ],
                }],
            },
            green("202252", vec![401, 606], "is_dirtgrade==1", 1),
            green(
                "200162",
                vec![403, 601],
                "ground_condition==2@ground_condition==3@ground_condition==4",
                3,
            ),
        ]
    }

    /// The three extra greens from the second saved scenario, all
    /// gate-deterministic on this config: Fall Runner ○ (200192/603,
    /// `season==3`), Right-Handed ○ (200012/608, `rotation==1`), Sunny Days ○
    /// (200212/602, `weather==1`).
    fn copano_rickey_extra_greens() -> Vec<Skill> {
        let green = |id: &str, tags: Vec<i32>, cond: &str, effect_type: i32| Skill {
            skill_id: SkillId::new(id),
            rarity: SkillRarity::White,
            tags,
            alternatives: vec![SkillAlternative {
                base_duration: -10000.0,
                cooldown_time: Some(0.0),
                condition: cond.to_owned(),
                precondition: Some(String::new()),
                effects: vec![RawSkillEffect {
                    modifier: 400000.0,
                    target: SkillTarget::SelfTarget,
                    effect_type,
                    value_usage: Some(1),
                    value_level_usage: Some(1),
                    pre_applied_multiplier: None,
                }],
            }],
        };
        vec![
            green("200192", vec![401, 603], "season==3", 1),
            green("200012", vec![401, 608], "rotation==1", 1),
            green("200212", vec![404, 602], "weather==1", 4),
        ]
    }

    /// Build a Copano Rickey Pace Chaser on a dirt-grade (track 10101) course
    /// with the given skills, prepared under Good ground so all three greens'
    /// conditions hold at the gate.
    fn copano_on_dirtgrade(skills: Vec<Skill>) -> Runner {
        use crate::course::model::CourseData;
        use crate::shared_kernel::language::{DistanceType, Orientation, Surface};

        let course = CourseData {
            course_id: 11103,
            race_track_id: 10101, // in DIRT_GRADE_TRACK_IDS -> is_dirtgrade==1
            distance: 2000.0,
            distance_type: DistanceType::Mid,
            surface: Surface::Dirt,
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
        };
        use crate::shared_kernel::language::{Season, Weather};
        let mut rp = test_race_params();
        rp.ground = GroundCondition::Good; // ground_condition==2
        rp.season = Season::Autumn; // season==3 (Fall Runner)
        rp.weather = Weather::Sunny; // weather==1 (Sunny Days)

        let props = CreateRunner {
            outfit_id: "109801".to_owned(),
            name: "Copano Rickey".to_owned(),
            mood: Mood::Normal,
            strategy: Strategy::PaceChaser,
            popularity: 0,
            team: None,
            aptitudes: RunnerAptitudes {
                distance: Aptitude::S,
                strategy: Aptitude::A,
                surface: Aptitude::A,
            },
            stats: StatLine {
                speed: 1300,
                stamina: 1000,
                power: 1200,
                guts: 600,
                wit: 1100,
            },
            skills,
            forced_positions: HashMap::new(),
            injected_debuffs: vec![],
            forced_rushed_regions: vec![],
            forced_dueling_regions: vec![],
            forced_spot_struggle_regions: vec![],
            forced_rank: vec![],
            gate: None,
            forced_start_delay: None,
            forced_last_spurt_distance: None,
        };
        let mut r = Runner::create(
            RunnerId(0),
            &course,
            GroundCondition::Good,
            props,
            Box::new(NoopStaminaPolicy),
            Box::new(Xoshiro256StarStar::from_u32_seed(1)),
        );

        let catalog = build_catalog();
        let parser = ConditionParser::new(&catalog);
        let wc = test_whole_course(&course);
        let ctx = PrepareContext {
            course: &course,
            base_speed: 20.0,
            condition_resolution: ConditionResolution::Dynamic,
            pos_keep_end_multiplier: 3.0,
            race_params: &rp,
            whole_course: &wc,
            parser: &parser,
            skill_samples: 4,
            round_iteration: 0,
        };
        r.on_prepare(Box::new(Xoshiro256StarStar::from_u64_seed(7)), &ctx);
        r
    }

    /// Force `100981` to activate and return the runner post-proc.
    fn proc_luck_runs_my_way(r: &mut Runner) {
        r.wit_checks_enabled = false;
        let idx = r
            .pending_skills
            .iter()
            .position(|s| s.skill_id.as_str() == "100981")
            .expect("100981 must be pending after prepare");
        let trigger = r.pending_skills[idx].trigger;
        r.position = trigger.start + 0.5;
        r.process_skill_activations(&FieldView::at_gate(), 2000.0);
    }

    #[test]
    fn copano_rickey_usage_14_benefits_from_activated_greens() {
        // Uma 1: 100981 + three greens (201532/612, 202252/606, 200162/601).
        let mut uma1 = copano_on_dirtgrade(copano_rickey_full_skills());
        // All three greens fire at the gate and are recorded.
        assert_eq!(
            uma1.activated_ledger.activated_green_count(),
            3,
            "the three green skills must activate on a dirt-grade Good-ground course"
        );

        proc_luck_runs_my_way(&mut uma1);
        assert!(uma1.used_skills.contains("100981"), "100981 must proc");

        // Uma 2: only 100981 -> no greens -> tier 0x baseline.
        let mut uma2 = copano_on_dirtgrade(vec![copano_rickey_full_skills()
            .into_iter()
            .next()
            .expect("100981 is the first skill")]);
        assert_eq!(uma2.activated_ledger.activated_green_count(), 0);
        proc_luck_runs_my_way(&mut uma2);
        assert!(uma2.used_skills.contains("100981"));

        // Target speed carries no start-dash term, so absolute values are clean:
        // green count 3 -> tier 1x adds the usage-14 0.05 on top of the shared
        // Direct 0.25; the no-green runner stays at 0.25.
        assert!(
            (uma1.modifiers.target_speed.total() - 0.30).abs() < 1e-9,
            "uma1 target speed was {}",
            uma1.modifiers.target_speed.total()
        );
        assert!(
            (uma2.modifiers.target_speed.total() - 0.25).abs() < 1e-9,
            "uma2 target speed was {}",
            uma2.modifiers.target_speed.total()
        );

        // Acceleration shares the +24.0 start-dash baseline on both runners, so
        // the usage-14 contribution is the delta: uma1 gets +0.05, uma2 +0.0.
        let accel_delta = uma1.modifiers.accel.total() - uma2.modifiers.accel.total();
        assert!(
            (accel_delta - 0.05).abs() < 1e-9,
            "usage-14 accel delta was {accel_delta} (uma1 {}, uma2 {})",
            uma1.modifiers.accel.total(),
            uma2.modifiers.accel.total()
        );
    }

    #[test]
    fn copano_rickey_usage_14_reaches_tier_3_with_six_greens() {
        // Second saved scenario: 100981 + six greens (201532/612, 202252/606,
        // 200162/601, 200192/603, 200012/608, 200212/602). All six are
        // gate-deterministic on course 11103 (dirt grade, Good, Autumn, Sunny,
        // clockwise, Pace Chaser).
        let mut skills = copano_rickey_full_skills();
        skills.extend(copano_rickey_extra_greens());
        let mut uma1 = copano_on_dirtgrade(skills);
        assert_eq!(
            uma1.activated_ledger.activated_green_count(),
            6,
            "all six greens must activate"
        );
        proc_luck_runs_my_way(&mut uma1);
        assert!(uma1.used_skills.contains("100981"));

        // No-green baseline.
        let mut uma2 = copano_on_dirtgrade(vec![copano_rickey_full_skills()
            .into_iter()
            .next()
            .expect("100981 is the first skill")]);
        proc_luck_runs_my_way(&mut uma2);

        // 6 greens -> tier 3x: usage-14 Target Speed 0.05*3 = 0.15 on top of the
        // Direct 0.25 -> 0.40; usage-14 accel delta 0.15.
        assert!(
            (uma1.modifiers.target_speed.total() - 0.40).abs() < 1e-9,
            "uma1 target speed was {}",
            uma1.modifiers.target_speed.total()
        );
        let accel_delta = uma1.modifiers.accel.total() - uma2.modifiers.accel.total();
        assert!(
            (accel_delta - 0.15).abs() < 1e-9,
            "usage-14 accel delta was {accel_delta}"
        );
    }

    #[test]
    fn pending_skills_built_on_prepare() {
        let mut r = runner_with_skills(vec![target_speed_skill(
            "100001",
            SkillRarity::Gold,
            "phase>=2",
        )]);
        prepare(&mut r);
        assert_eq!(r.pending_skills.len(), 1);
        assert_eq!(r.pending_skills[0].skill_id.as_str(), "100001");
    }

    fn debuff_skill(id: &str) -> Skill {
        // Negative current-speed targeting all (other) runners: an injectable
        // external debuff.
        Skill {
            skill_id: SkillId::new(id),
            rarity: SkillRarity::White,
            tags: vec![],
            alternatives: vec![SkillAlternative {
                base_duration: 30000.0,
                cooldown_time: None,
                condition: "phase>=0".to_owned(),
                precondition: None,
                effects: vec![RawSkillEffect {
                    modifier: -5000.0,
                    target: SkillTarget::All,
                    effect_type: 31, // CurrentSpeed
                    value_usage: None,
                    value_level_usage: None,
                    pre_applied_multiplier: None,
                }],
            }],
        }
    }

    #[test]
    fn injected_debuff_queues_fixed_position_targeted_skill() {
        let mut r = runner_with_skills(vec![]);
        r.injected_debuffs = vec![crate::runner::InjectedDebuff {
            skill: debuff_skill("700001"),
            position: 800.0,
        }];
        prepare(&mut r);
        assert_eq!(r.pending_targeted_skills.len(), 1);
        let pending = &r.pending_targeted_skills[0];
        assert_eq!(pending.skill_id.as_str(), "700001");
        assert!(matches!(pending.origin, TargetedSkillOrigin::Injection));
        // Fixed-position policy clips the trigger window around position 800.
        assert!(pending.trigger.start <= 800.0 && pending.trigger.end >= 800.0);
        assert_eq!(pending.effects.len(), 1);
        assert!(pending.effects[0].modifier < 0.0);
    }

    #[test]
    fn injected_non_debuff_effect_is_ignored() {
        // A self-targeted positive effect is not an external debuff.
        let mut skill = debuff_skill("700002");
        skill.alternatives[0].effects[0].target = SkillTarget::SelfTarget;
        skill.alternatives[0].effects[0].modifier = 5000.0;
        let mut r = runner_with_skills(vec![]);
        r.injected_debuffs = vec![crate::runner::InjectedDebuff {
            skill,
            position: 800.0,
        }];
        prepare(&mut r);
        assert!(r.pending_targeted_skills.is_empty());
    }

    #[test]
    fn target_speed_skill_activates_and_applies_modifier() {
        let mut r = runner_with_skills(vec![target_speed_skill(
            "100001",
            SkillRarity::Gold,
            "phase>=2",
        )]);
        prepare(&mut r);
        r.wit_checks_enabled = false;
        let trigger = r.pending_skills[0].trigger;
        r.position = trigger.start + 0.5;

        let field = FieldView::at_gate();
        r.process_skill_activations(&field, 2400.0);

        assert_eq!(r.target_speed_skills_active.len(), 1);
        assert!(r.modifiers.target_speed.total() > 0.0);
        assert_eq!(r.skills_activated_count, 1);
        assert!(r.used_skills.contains("100001"));
        assert!(r.pending_skills.is_empty());
    }

    #[test]
    fn forced_position_bypasses_dynamic_condition_and_wit_check() {
        // `order==1` resolves to a dynamic gate; with no field resolved
        // (`FieldView::at_gate`, order None) it can never pass. A forced
        // position must activate the skill anyway — and deterministically,
        // with wit checks left enabled.
        let skill = target_speed_skill("100001", SkillRarity::Gold, "phase>=0&order==1");

        // Control: without forcing, the dynamic gate holds the skill back.
        let mut control = runner_with_skills(vec![skill.clone()]);
        prepare(&mut control);
        control.position = 1000.5;
        control.process_skill_activations(&FieldView::at_gate(), 2400.0);
        assert_eq!(control.skills_activated_count, 0, "control must not fire");

        let mut r =
            runner_with_skills_forced(vec![skill], HashMap::from([("100001".to_owned(), 1000.0)]));
        prepare(&mut r);
        assert_eq!(r.pending_skills.len(), 1);
        assert!(r.pending_skills[0].forced);
        assert_eq!(r.pending_skills[0].trigger, Region::new(1000.0, 1010.0));

        r.position = 1000.5;
        r.process_skill_activations(&FieldView::at_gate(), 2400.0);
        assert_eq!(r.skills_activated_count, 1);
        assert!(r.used_skills.contains("100001"));
    }

    #[test]
    fn forced_position_overrides_statically_unsatisfiable_condition() {
        // `distance_type==1` (sprint) never matches the Long test course: the
        // trigger survives only as a sentinel `Region::INVALID` window the
        // runner can never reach. Forcing a position must replace it.
        let skill = target_speed_skill("100002", SkillRarity::Gold, "distance_type==1");

        let mut control = runner_with_skills(vec![skill.clone()]);
        prepare(&mut control);
        // The sentinel window sits beyond the course end: unreachable.
        assert!(control.pending_skills[0].trigger.start > 2400.0);

        let mut r =
            runner_with_skills_forced(vec![skill], HashMap::from([("100002".to_owned(), 1200.0)]));
        prepare(&mut r);
        assert_eq!(r.pending_skills.len(), 1);
        assert!(r.pending_skills[0].forced);
        assert_eq!(r.pending_skills[0].trigger, Region::new(1200.0, 1210.0));

        r.position = 1200.5;
        r.process_skill_activations(&FieldView::at_gate(), 2400.0);
        assert_eq!(r.skills_activated_count, 1);
        assert!(r.used_skills.contains("100002"));
        assert!((r.modifiers.target_speed.total() - 0.45).abs() < 1e-9);
    }

    #[test]
    fn forced_position_synthesizes_trigger_when_none_is_built() {
        // A condition the parser cannot handle aborts trigger building
        // entirely (`build_skill_data` returns no triggers), so there is
        // nothing for the forced position to override. The runner must
        // synthesize a forced pending entry from the alternative's effects.
        let skill = target_speed_skill("100003", SkillRarity::Gold, "unknown_token_xyz==1");

        let mut control = runner_with_skills(vec![skill.clone()]);
        prepare(&mut control);
        assert!(control.pending_skills.is_empty(), "control has no trigger");

        let mut r =
            runner_with_skills_forced(vec![skill], HashMap::from([("100003".to_owned(), 800.0)]));
        prepare(&mut r);
        assert_eq!(r.pending_skills.len(), 1);
        assert!(r.pending_skills[0].forced);
        assert_eq!(r.pending_skills[0].trigger, Region::new(800.0, 810.0));

        r.position = 800.5;
        r.process_skill_activations(&FieldView::at_gate(), 2400.0);
        assert_eq!(r.skills_activated_count, 1);
        assert!(r.used_skills.contains("100003"));
    }

    #[test]
    fn activation_records_green_tags_in_ledger() {
        let mut green = target_speed_skill("200011", SkillRarity::Gold, "phase>=2");
        green.tags = vec![401, 608];
        let mut r = runner_with_skills(vec![green]);
        prepare(&mut r);
        r.wit_checks_enabled = false;
        // Tags flow through the trigger onto the pending skill.
        assert_eq!(r.pending_skills[0].tags, vec![401, 608]);
        let trigger = r.pending_skills[0].trigger;
        r.position = trigger.start + 0.5;
        r.process_skill_activations(&FieldView::at_gate(), 2400.0);
        assert_eq!(r.skills_activated_count, 1);
        // The green-tagged activation is recorded for caster-context scaling.
        assert_eq!(r.activated_ledger.activated_green_count(), 1);
    }

    #[test]
    fn activation_ignores_non_green_tags_in_ledger() {
        // 99 Problems-shaped tags (404/405) are not counted greens.
        let mut non_green = target_speed_skill("202181", SkillRarity::Gold, "phase>=2");
        non_green.tags = vec![404, 405];
        let mut r = runner_with_skills(vec![non_green]);
        prepare(&mut r);
        r.wit_checks_enabled = false;
        let trigger = r.pending_skills[0].trigger;
        r.position = trigger.start + 0.5;
        r.process_skill_activations(&FieldView::at_gate(), 2400.0);
        assert_eq!(r.skills_activated_count, 1);
        assert_eq!(r.activated_ledger.activated_green_count(), 0);
    }

    /// Wild Wind / Speed Eater bundle a self-target buff with an opponent-facing
    /// Current Speed debuff in the same skill. The caster must receive the
    /// self-buff but never the debuff (regression: it used to self-apply the
    /// Current Speed reduction, slowing its own runner).
    fn wild_wind_like_skill(id: &str) -> Skill {
        Skill {
            skill_id: SkillId::new(id),
            rarity: SkillRarity::Gold,
            tags: vec![],
            alternatives: vec![SkillAlternative {
                base_duration: 18000.0,
                cooldown_time: None,
                condition: "phase>=2".to_owned(),
                precondition: None,
                effects: vec![
                    RawSkillEffect {
                        modifier: 3500.0,
                        target: SkillTarget::SelfTarget,
                        effect_type: 27, // TargetSpeed (self buff)
                        value_usage: None,
                        value_level_usage: None,
                        pre_applied_multiplier: None,
                    },
                    RawSkillEffect {
                        modifier: -1500.0,
                        target: SkillTarget::All,
                        effect_type: 21, // CurrentSpeed (opponent debuff)
                        value_usage: None,
                        value_level_usage: None,
                        pre_applied_multiplier: None,
                    },
                ],
            }],
        }
    }

    #[test]
    fn owned_debuff_effect_is_not_self_applied() {
        let mut r = runner_with_skills(vec![wild_wind_like_skill("202131")]);
        prepare(&mut r);
        r.wit_checks_enabled = false;
        let trigger = r.pending_skills[0].trigger;
        r.position = trigger.start + 0.5;

        let field = FieldView::at_gate();
        r.process_skill_activations(&field, 2400.0);

        // Self-target buff applied.
        assert_eq!(r.target_speed_skills_active.len(), 1);
        assert!(r.modifiers.target_speed.total() > 0.0);
        // Opponent-facing Current Speed debuff must NOT land on the caster.
        assert!(r.current_speed_skills_active.is_empty());
        assert!((r.modifiers.current_speed.total()).abs() < 1e-9);
        // The skill still counts as activated.
        assert_eq!(r.skills_activated_count, 1);
        assert!(r.used_skills.contains("202131"));
    }

    #[test]
    fn recovery_increments_heal_count() {
        let skill = Skill {
            skill_id: SkillId::new("300001"),
            rarity: SkillRarity::White,
            tags: vec![],
            alternatives: vec![SkillAlternative {
                base_duration: 0.0,
                cooldown_time: None,
                condition: "phase>=2".to_owned(),
                precondition: None,
                effects: vec![RawSkillEffect {
                    modifier: 5000.0,
                    target: SkillTarget::SelfTarget,
                    effect_type: 9,
                    value_usage: None,
                    value_level_usage: None,
                    pre_applied_multiplier: None,
                }],
            }],
        };
        let mut r = runner_with_skills(vec![skill]);
        prepare(&mut r);
        r.wit_checks_enabled = false;
        let trigger = r.pending_skills[0].trigger;
        r.position = trigger.start + 0.5;
        let field = FieldView::at_gate();
        r.process_skill_activations(&field, 2400.0);
        assert_eq!(r.heals_activated_count, 1);
    }

    #[test]
    fn derive_target_strategy_reads_both_hesitant_and_frenzied_tokens() {
        // Hesitant (EnemyStrategy) family.
        assert_eq!(
            derive_target_strategy("running_style_count_nige_otherself>=1"),
            Some(Strategy::FrontRunner)
        );
        // Frenzied (KakariStrategy) family — the four running styles.
        assert_eq!(
            derive_target_strategy(
                "running_style_temptation_opponent_count_nige>=1&is_temptation==0"
            ),
            Some(Strategy::FrontRunner)
        );
        assert_eq!(
            derive_target_strategy(
                "running_style_temptation_opponent_count_senko>=1&is_temptation==0"
            ),
            Some(Strategy::PaceChaser)
        );
        assert_eq!(
            derive_target_strategy(
                "running_style_temptation_opponent_count_sashi>=1&is_temptation==0"
            ),
            Some(Strategy::LateSurger)
        );
        assert_eq!(
            derive_target_strategy(
                "running_style_temptation_opponent_count_oikomi>=1&is_temptation==0"
            ),
            Some(Strategy::EndCloser)
        );
        assert_eq!(derive_target_strategy("phase>=2"), None);
    }

    #[test]
    fn change_strategy_skips_wit_check() {
        let mut r = runner_with_skills(vec![runaway_skill("phase>=2")]);
        r.strategy = Strategy::FrontRunner;
        prepare(&mut r);

        assert_eq!(r.pending_skills.len(), 1);
        assert!(r.should_skip_wit_check(&r.pending_skills[0]));
    }

    #[test]
    fn runaway_activates_at_gate_and_promotes_only_position_keep_strategy() {
        let mut r = runner_with_skills(vec![runaway_skill("running_style==1")]);
        r.strategy = Strategy::FrontRunner;
        r.position_keep_strategy = Strategy::FrontRunner;

        prepare(&mut r);

        assert_eq!(
            r.strategy,
            Strategy::FrontRunner,
            "the race-entry strategy remains unchanged"
        );
        assert_eq!(r.position_keep_strategy, Strategy::Runaway);
        assert_eq!(r.skills_activated_count, 1);
        assert!(r.used_skills.contains("202051"));
    }

    #[test]
    fn savvy_skill_builds_trigger_with_only_wisdom_effect() {
        // Regression: a Savvy skill (Wisdom Up + vision) must still produce a
        // trigger — carrying only the modeled Wisdom Up effect — instead of being
        // discarded wholesale because of the unmodeled vision effect.
        let triggers = build(&savvy_skill("201531"));
        assert_eq!(triggers.len(), 1, "the Savvy skill must still trigger");
        assert_eq!(
            triggers[0].effects.len(),
            1,
            "only the modeled effect remains"
        );
        assert_eq!(triggers[0].effects[0].effect_type, SkillType::WisdomUp);
    }

    #[test]
    fn savvy_skill_activates_at_gate_and_applies_wit_bonus() {
        // End-to-end: Pace Chaser Savvy is a green (running-style) skill, so it
        // activates at the gate during `on_prepare` and adds its wit bonus —
        // rather than silently never firing because of the bundled vision effect.
        let baseline = runner_with_skills(vec![]);
        let wit_before = baseline.adjusted_stats.wit;

        let mut r = runner_with_skills(vec![savvy_skill("201531")]);
        prepare(&mut r);

        // Green skill consumed off the pending queue at the gate.
        assert!(r.pending_skills.is_empty());
        assert_eq!(
            r.skills_activated_count, 1,
            "Savvy must fire, not be dropped"
        );
        assert!(r.used_skills.contains("201531"));
        assert_eq!(
            r.adjusted_stats.wit,
            wit_before + 60.0,
            "the modeled Wisdom Up (+60) must apply"
        );
    }

    #[test]
    fn receive_targeted_effect_applies_current_speed() {
        let mut r = runner_with_skills(vec![]);
        prepare(&mut r);
        let effects = vec![ResolvedSkillEffect {
            target: SkillTarget::All,
            effect_type: SkillType::CurrentSpeed,
            base_duration: 3.0,
            modifier: -0.5,
        }];
        r.receive_targeted_effect(SkillId::new("999"), effects, RunnerId(5), 2400.0);
        assert_eq!(r.targeted_current_speed_active.len(), 1);
        assert!(r.modifiers.current_speed.total() < 0.0);
        assert_eq!(r.used_targeted_skills.len(), 1);
        // The receiver applies the caster-resolved value verbatim: no re-roll,
        // no re-resolution (enforced by the ResolvedSkillEffect type).
        assert_eq!(r.targeted_current_speed_active[0].skill.modifier, -0.5);
    }

    #[test]
    fn active_skill_expires_and_reverses_modifier() {
        let mut r = runner_with_skills(vec![target_speed_skill(
            "100001",
            SkillRarity::Gold,
            "phase>=2",
        )]);
        prepare(&mut r);
        r.wit_checks_enabled = false;
        let trigger = r.pending_skills[0].trigger;
        r.position = trigger.start + 0.5;
        let field = FieldView::at_gate();
        r.process_skill_activations(&field, 2400.0);
        let applied = r.modifiers.target_speed.total();
        assert!(applied > 0.0);
        r.target_speed_skills_active[0].duration_timer.t = 0.0;
        r.process_skill_activations(&field, 2400.0);
        assert!(r.target_speed_skills_active.is_empty());
        assert!(r.modifiers.target_speed.total().abs() < 1e-9);
    }
}
