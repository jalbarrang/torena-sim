//! # uma-sim-vacuum
//!
//! The **synthetic / vacuum** race engine (ADR-0005). Typically one primary
//! runner, optionally with context runners (e.g. a dedicated pacer); dueling is
//! *synthesized* (artificial [`DuelingRates`]) and field-dependent skill
//! conditions are *approximated*. This crate owns:
//!
//! - the [`Race`](race::Race) aggregate: a small-field loop that **produces
//!   `FieldInputs` from approximate condition values + synthetic rates** (no
//!   live dueling/spot-struggle coordinators, but external debuffs DO route
//!   across the field), then calls the shared pure step in
//!   `uma-sim-primitives`;
//! - the [`run_compare`](simulation::run_compare) use case + paired-delta
//!   orchestration;
//! - the [`CompareDataCollector`](collectors::CompareDataCollector) read-model.
//!
//! It contains **no paradigm flag** — there is no contested branch; the
//! contested bench lives in `uma-sim-race`. Both engines run the same step
//! kernel and differ only in how they produce `FieldInputs`.
//!
//! [`DuelingRates`]: uma_sim_primitives::runner::mechanics::DuelingRates

pub mod collectors;
pub mod race;
pub mod simulation;

pub use race::{Race, SimulationSettings};
pub use simulation::{run_compare, CompareSimParams, SimError};
