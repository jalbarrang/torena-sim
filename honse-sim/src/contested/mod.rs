//! Live-field race engine.
//!
//! The engine derives order, proximity, position keeping, dueling, spot
//! struggle, and dynamic skill conditions from one immutable field snapshot per
//! tick. It resolves field inputs before it calls the shared runner step kernel.

pub mod collectors;
pub mod race;
pub mod replay;
pub mod simulation;

pub use race::{Race, SimulationSettings};
pub use replay::{
    RaceReplay, RaceReplayCollector, ReplayEvent, ReplayFrame, ReplayHorseFrame, ReplayHorseResult,
};
pub use simulation::{
    run_contested_compare, run_race_sim, ContestedCompareParams, FinishEntry, RaceSimParams,
    RaceSimResult, SimError, DEFAULT_FIELD_SIZE, MAX_FIELD_SIZE, MIN_FIELD_SIZE,
};
