//! # uma-sim-race
//!
//! The **contested** race engine (ADR-0005). Nine real runners; contention
//! (dueling, spot-struggle, position-keep, blocking) and skill/terrain
//! interactions emerge from actual field proximity. This crate owns:
//!
//! - the [`Race`](race::Race) aggregate: builds the live field snapshot, runs
//!   the contention coordinator passes, and **produces `FieldInputs` from the
//!   real field**, then calls the shared pure step in `uma-sim-primitives`;
//! - the [`run_race_sim`](simulation::run_race_sim) use case + distribution
//!   orchestration over many randomized rounds;
//! - the [`run_contested_compare`](simulation::run_contested_compare) use case:
//!   compare-grade telemetry from a live contested field;
//! - the read-model collectors (`RaceSimDataCollector`, `RaceEventLogCollector`).
//!
//! It contains **no paradigm flag** — vacuum compare remains in
//! `uma-sim-vacuum`; contested compare is a separate use-case composition over
//! this engine. Both engines run the same step kernel and differ only in how
//! they produce `FieldInputs`.

pub mod collectors;
pub mod race;
pub mod simulation;

pub use race::{Race, SimulationSettings};
pub use simulation::{
    run_contested_compare, run_race_sim, ContestedCompareParams, FinishEntry, RaceSimParams,
    RaceSimResult, SimError, FIELD_SIZE,
};
