//! Synthetic comparison engine.
//!
//! The engine derives field inputs from approximate condition values and
//! configured dueling rates. It uses the same runner step kernel as the
//! contested engine without live dueling or spot-struggle coordination.

pub mod collectors;
pub mod race;
pub mod simulation;

pub use race::{Race, SimulationSettings};
pub use simulation::{run_compare, CompareSimParams, SimError};
