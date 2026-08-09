//! Race-wide input **value objects** shared across contexts: [`StatLine`] and
//! [`RaceParameters`].
//!
//! These are immutable configuration the simulation reads but never mutates.
//! They live in the shared kernel because the skills condition sub-domain (an
//! anti-corruption seam) needs them without depending on the `racing` context.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::shared_kernel::ids::SkillId;
use crate::shared_kernel::language::{
    Grade, GroundCondition, Season, Strategy, TimeOfDay, Weather,
};

/// A runner's five core stats.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct StatLine {
    /// Speed stat.
    pub speed: i32,
    /// Stamina stat.
    pub stamina: i32,
    /// Power stat.
    pub power: i32,
    /// Guts stat.
    pub guts: i32,
    /// Wit (wisdom) stat.
    pub wit: i32,
}

/// Race-wide parameters (track conditions, field composition, …) supplied as
/// input to the simulation and read by skill conditions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RaceParameters {
    /// Ground (track) condition.
    pub ground: GroundCondition,
    /// Weather.
    pub weather: Weather,
    /// Season.
    pub season: Season,
    /// Time of day.
    pub time_of_day: TimeOfDay,
    /// Race grade.
    pub grade: Grade,
    /// Number of runners in the field.
    #[serde(default)]
    pub num_umas: Option<u32>,
    /// Inclusive 1-indexed finishing-order range `[lo, hi]` this runner is
    /// being evaluated for (used by order conditions).
    #[serde(default)]
    pub order_range: Option<(u32, u32)>,
    /// The skill currently being evaluated, when relevant.
    #[serde(default)]
    pub skill_id: Option<SkillId>,
    /// Count of runners per strategy in the field.
    #[serde(default)]
    pub strategy_counts: Option<HashMap<Strategy, u32>>,
    /// Count of common (shared) skills across the field, keyed by skill id.
    #[serde(default)]
    pub common_skills: Option<HashMap<String, u32>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stat_line_round_trips() {
        let stats = StatLine {
            speed: 1200,
            stamina: 900,
            power: 800,
            guts: 600,
            wit: 700,
        };
        let json = serde_json::to_string(&stats).expect("serialize");
        let back: StatLine = serde_json::from_str(&json).expect("parse");
        assert_eq!(back, stats);
    }

    #[test]
    fn race_parameters_round_trips() {
        // Numeric-enum -> domain translation lives in the wasm `dto.rs` boundary
        // layer; core round-trips through its own symmetric serde representation.
        let params = RaceParameters {
            ground: GroundCondition::Firm,
            weather: Weather::Sunny,
            season: Season::Spring,
            time_of_day: TimeOfDay::Midday,
            grade: Grade::G1,
            num_umas: Some(18),
            order_range: Some((1, 9)),
            skill_id: None,
            strategy_counts: None,
            common_skills: None,
        };
        let json = serde_json::to_string(&params).expect("serialize");
        assert!(json.contains("\"timeOfDay\":"), "json was: {json}");
        let back: RaceParameters = serde_json::from_str(&json).expect("parse");
        assert_eq!(back, params);
        assert_eq!(back.order_range, Some((1, 9)));
    }
}
