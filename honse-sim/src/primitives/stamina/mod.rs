//! # Stamina bounded context
//!
//! The HP budget expressed as a pluggable **policy** (strategy object) plus the
//! last-spurt / spurt-distance **domain service**.

pub mod game_policy;
pub mod policy;
pub mod spurt;
