//! Projection primitives: pure read-model helpers that reconcile a stream of
//! per-tick active skill effects into `[start, end]` position-range activation
//! logs (ADR-0005).
//!
//! These are pure functions of already-observed effect snapshots — they never
//! touch a `Runner`, the field, or any engine context — so both engines and the
//! legacy combined engine share them. The engine-side observers feed them
//! per-tick [`ActiveEffectView`] slices and the open/closed log maps.

use std::collections::HashMap;

/// Snapshot of one active (duration-based) skill effect, exposed to the compare
/// read-model so it can reconcile effect-activation position ranges.
#[derive(Debug, Clone, PartialEq)]
pub struct ActiveEffectView {
    /// Skill id that owns the effect.
    pub skill_id: String,
    /// Effect type discriminant.
    pub effect_type: i32,
    /// Effect target discriminant.
    pub effect_target: i32,
    /// Effect modifier (real units).
    pub modifier: f64,
}

/// Perspective of a logged skill effect (matches TS `SkillPerspective`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EffectPerspective {
    /// The effect was cast by this runner on itself.
    SelfCast,
    /// The effect was applied to this runner by another.
    Other,
}

/// One activation of a skill effect tracked as a `[start, end]` position range
/// (port of TS `SkillEffectLog`).
#[derive(Debug, Clone, PartialEq)]
pub struct SkillEffectLog {
    /// Unique id for this activation within the round.
    pub execution_id: String,
    /// Skill id that produced the effect.
    pub skill_id: String,
    /// Position where the effect began.
    pub start: f64,
    /// Position where the effect ended.
    pub end: f64,
    /// Whether self-cast or externally applied.
    pub perspective: EffectPerspective,
    /// Effect type discriminant.
    pub effect_type: i32,
    /// Effect target discriminant.
    pub effect_target: i32,
}

/// A reference into the open-log bookkeeping: `(skill_id, index-into-logs)`.
pub type OpenLogRef = (String, usize);

/// Aggregate one tick's active effects into per-key counts.
pub fn count_effects(effects: &[ActiveEffectView]) -> HashMap<String, (usize, ActiveEffectView)> {
    let mut counts: HashMap<String, (usize, ActiveEffectView)> = HashMap::new();
    for effect in effects {
        let key = format!(
            "{}:{}:{}:{:.6}",
            effect.skill_id, effect.effect_type, effect.effect_target, effect.modifier
        );
        counts
            .entry(key)
            .and_modify(|(c, _)| *c += 1)
            .or_insert((1, effect.clone()));
    }
    counts
}

/// Open new logs for newly-active effects and close logs whose count dropped.
#[allow(
    clippy::too_many_arguments,
    reason = "effect-log reconciliation threads several independent collector \
               inputs/outputs; grouping them would add an opaque param struct \
               without improving clarity"
)]
pub fn reconcile_effects(
    counts: &HashMap<String, (usize, ActiveEffectView)>,
    open: &mut HashMap<String, Vec<OpenLogRef>>,
    logs: &mut HashMap<String, Vec<SkillEffectLog>>,
    perspective: EffectPerspective,
    position: f64,
    seed: u64,
    runner_id: u32,
    seq: &mut u64,
) {
    // Open new logs up to the current count per key.
    for (key, (count, effect)) in counts {
        let open_refs = open.entry(key.clone()).or_default();
        while open_refs.len() < *count {
            let skill_logs = logs.entry(effect.skill_id.clone()).or_default();
            let log = SkillEffectLog {
                execution_id: format!("{seed}-{runner_id}-{seq}"),
                skill_id: effect.skill_id.clone(),
                start: position,
                end: position,
                perspective,
                effect_type: effect.effect_type,
                effect_target: effect.effect_target,
            };
            *seq += 1;
            skill_logs.push(log);
            open_refs.push((effect.skill_id.clone(), skill_logs.len() - 1));
        }
    }
    // Close logs whose effect count dropped.
    let keys: Vec<String> = open.keys().cloned().collect();
    for key in keys {
        let expected = counts.get(&key).map_or(0, |(c, _)| *c);
        if let Some(open_refs) = open.get_mut(&key) {
            while open_refs.len() > expected {
                if let Some((skill_id, idx)) = open_refs.pop() {
                    if let Some(skill_logs) = logs.get_mut(&skill_id) {
                        if let Some(log) = skill_logs.get_mut(idx) {
                            log.end = position;
                        }
                    }
                }
            }
            if open_refs.is_empty() {
                open.remove(&key);
            }
        }
    }
}

/// Close every still-open log at `position` (round end).
pub fn close_all(
    open: &mut HashMap<String, Vec<OpenLogRef>>,
    logs: &mut HashMap<String, Vec<SkillEffectLog>>,
    position: f64,
) {
    for (_, open_refs) in open.drain() {
        for (skill_id, idx) in open_refs {
            if let Some(skill_logs) = logs.get_mut(&skill_id) {
                if let Some(log) = skill_logs.get_mut(idx) {
                    log.end = position;
                }
            }
        }
    }
}
