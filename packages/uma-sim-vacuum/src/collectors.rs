//! Compatibility re-exports for compare read-models.
//!
//! The compare collector is shared by both the vacuum and contested engines, so
//! its implementation lives in `uma-sim-primitives::compare`. This module keeps
//! the historic `uma_sim_vacuum::collectors::{...}` public API stable for the
//! WASM DTO layer and downstream callers.

pub use uma_sim_primitives::compare::{
    CompareData, CompareDataCollector, CompareRound, CompareRoundData,
};
pub use uma_sim_primitives::projection::{EffectPerspective, SkillEffectLog};
