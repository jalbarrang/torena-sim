//! Re-exports for shared compare read models.
//!
//! The vacuum and contested engines use the same compare collector. This module
//! keeps the vacuum API focused while the implementation remains shared.

pub use uma_sim_primitives::compare::{
    CompareData, CompareDataCollector, CompareRound, CompareRoundData,
};
pub use uma_sim_primitives::projection::{EffectPerspective, SkillEffectLog};
