//! Synthetic comparison engine.
//!
//! The engine derives field inputs from approximate condition values and
//! configured dueling rates. It uses the same runner step kernel as the
//! contested engine. Dueling stays synthetic here, but spot struggle is a
//! proximity rule over the runners who are actually present, so it runs the same
//! shared coordinator the contested engine does (`primitives::spot_struggle`)
//! instead of a second approximation of the same mechanic.

pub mod collectors;
pub mod race;
pub mod ranking;
pub mod simulation;

pub use race::{Race, SimulationSettings};
pub use ranking::{rank_skills, RankCandidate, SkillRankData, SkillRankEntry, SkillRankParams};
pub use simulation::{
    run_basin_compare, run_basin_compare_indices, run_compare, run_compare_rounds,
    run_compare_summarized, run_paired_compare_rounds, run_paired_compare_summarized,
    run_position_compare, CompareSimParams, SimError,
};
