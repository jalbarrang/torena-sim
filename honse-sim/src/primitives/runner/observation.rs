//! `RunnerObservation` port implementation for the shared [`Runner`] entity.
//!
//! The observer read-model (`events::RunnerObservation`) and the `Runner` both
//! live in the shared primitives module, so the impl is field-agnostic shared support
//! both engines reuse (ADR-0005). It only reads runner state.

use crate::events::{ActiveEffectView, RunnerObservation, StaticEffectView, UsedTargetedView};
use crate::runner::Runner;
use crate::shared_kernel::ids::RunnerId;
use crate::stamina::ledger::StaminaLedger;

/// Read-only observation view of a [`Runner`] (the `RunnerObservation` port).
impl RunnerObservation for Runner {
    fn id(&self) -> RunnerId {
        self.id
    }
    fn accumulate_time(&self) -> f64 {
        self.accumulate_time.t
    }
    fn position(&self) -> f64 {
        self.position
    }
    fn current_speed(&self) -> f64 {
        self.current_speed
    }
    fn current_lane(&self) -> f64 {
        self.current_lane
    }
    fn current_health(&self) -> f64 {
        self.health_policy.current_health()
    }
    fn stamina_ledger(&self) -> Option<StaminaLedger> {
        self.health_policy.ledger().copied()
    }
    fn start_delay(&self) -> f64 {
        self.start_delay
    }
    fn running_style(&self) -> i64 {
        self.strategy as i64
    }
    fn guts_stat(&self) -> i64 {
        i64::from(self.stats.guts)
    }
    fn wit_stat(&self) -> i64 {
        i64::from(self.stats.wit)
    }
    fn finished(&self) -> bool {
        self.finished
    }
    fn finish_time(&self) -> f64 {
        self.finish_time
    }
    fn is_rushed(&self) -> bool {
        self.is_rushed
    }
    fn is_dueling(&self) -> bool {
        self.is_dueling
    }
    fn in_spot_struggle(&self) -> bool {
        self.in_spot_struggle
    }
    fn is_fully_charged(&self) -> bool {
        self.is_fully_charged
    }
    fn fully_charged_region(&self) -> Option<(f64, f64)> {
        self.fully_charged_region
            .map(|(start, end)| (start, if end >= 0.0 { end } else { self.position }))
    }
    fn fully_charged_accel(&self) -> Option<f64> {
        self.fully_charged_region.map(|_| self.fully_charged_accel)
    }
    fn is_last_spurt(&self) -> bool {
        self.is_last_spurt
    }
    fn out_of_hp(&self) -> bool {
        self.out_of_hp
    }
    fn skills_activated_count(&self) -> i64 {
        self.skills_activated_count
    }
    fn position_keep_state(&self) -> i64 {
        self.position_keep_state as i64
    }
    fn phase(&self) -> i64 {
        self.phase.index() as i64
    }
    fn is_overtaking(&self) -> bool {
        self.is_overtaking
    }
    fn is_side_blocked(&self) -> bool {
        self.is_side_blocked
    }
    fn used_skills(&self) -> Vec<&str> {
        self.used_skills.iter().map(String::as_str).collect()
    }
    fn current_speed_modifier(&self) -> f64 {
        self.modifiers.current_speed.total()
    }
    fn active_effects(&self) -> Vec<ActiveEffectView> {
        let buckets = [
            &self.target_speed_skills_active,
            &self.current_speed_skills_active,
            &self.acceleration_skills_active,
            &self.lane_movement_skills_active,
            &self.change_lane_skills_active,
        ];
        buckets
            .into_iter()
            .flatten()
            .map(|e| ActiveEffectView {
                skill_id: e.skill_id.0.clone(),
                effect_type: e.effect_type as i32,
                effect_target: e.effect_target as i32,
                modifier: e.modifier,
            })
            .collect()
    }
    fn targeted_active_effects(&self) -> Vec<ActiveEffectView> {
        let buckets = [
            &self.targeted_target_speed_active,
            &self.targeted_current_speed_active,
            &self.targeted_acceleration_active,
            &self.targeted_lane_movement_skills_active,
            &self.targeted_change_lane_skills_active,
        ];
        buckets
            .into_iter()
            .flatten()
            .map(|t| ActiveEffectView {
                skill_id: t.skill.skill_id.0.clone(),
                effect_type: t.skill.effect_type as i32,
                effect_target: t.skill.effect_target as i32,
                modifier: t.skill.modifier,
            })
            .collect()
    }
    fn used_targeted_skills(&self) -> Vec<UsedTargetedView> {
        self.used_targeted_skills
            .iter()
            .map(|u| UsedTargetedView {
                skill_id: u.skill_id.0.clone(),
                position: u.position,
                effect_type: u.effect_type as i32,
                effect_target: u.effect_target as i32,
            })
            .collect()
    }
    fn skill_static_effects(&self) -> Vec<StaticEffectView> {
        let mut out: Vec<StaticEffectView> = Vec::new();
        for skill in &self.skills {
            for alt in &skill.alternatives {
                for effect in &alt.effects {
                    out.push(StaticEffectView {
                        skill_id: skill.skill_id.0.clone(),
                        effect_type: effect.effect_type,
                        effect_target: effect.target as i32,
                    });
                }
            }
        }
        out
    }
    fn rushed_activations(&self) -> Vec<(f64, f64)> {
        self.rushed_activations.clone()
    }
    fn dueling_start_position(&self) -> f64 {
        self.dueling_start_position
    }
    fn dueling_end_position(&self) -> f64 {
        self.dueling_end_position
    }
    fn spot_struggle_start_position(&self) -> Option<f64> {
        self.spot_struggle_start_position
    }
    fn spot_struggle_end_position(&self) -> f64 {
        self.spot_struggle_end_position
    }
    fn has_achieved_full_spurt(&self) -> bool {
        self.has_achieved_full_spurt
    }
    fn out_of_hp_position(&self) -> Option<f64> {
        self.out_of_hp_position
    }
    fn non_full_spurt_velocity_diff(&self) -> Option<f64> {
        self.non_full_spurt_velocity_diff
    }
    fn non_full_spurt_delay_distance(&self) -> Option<f64> {
        self.non_full_spurt_delay_distance
    }
    fn first_position_in_late_race(&self) -> bool {
        self.first_position_in_late_race
    }
}
