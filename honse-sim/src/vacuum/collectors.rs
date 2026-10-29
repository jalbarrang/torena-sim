//! Re-exports for shared compare read models.
//!
//! The vacuum and contested engines use the same compare collector. This module
//! keeps the vacuum API focused while the implementation remains shared.

pub use uma_sim_primitives::compare::{
    BasinData, BasinDataCollector, BasinRound, BasinRoundData, CompareData, CompareDataCollector,
    CompareRound, CompareRoundData, PositionData, PositionDataCollector, PositionRound,
    PositionRoundData,
};
pub use uma_sim_primitives::projection::{EffectPerspective, SkillEffectLog};
