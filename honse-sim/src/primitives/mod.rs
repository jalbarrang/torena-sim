//! Shared simulation mechanics.
//!
//! This module contains field-independent values, course formulas, skills,
//! stamina, runner state, the per-tick step kernel, observers, and projections.
//! The contested and vacuum engines resolve field inputs before they call the
//! runner kernel.

pub mod shared_kernel;

pub mod course;
pub mod skills;

/// Shared compare-grade telemetry collector used by both race engines.
pub mod compare;

pub mod stamina;

pub mod position_keep;
pub mod runner;

pub mod events;
pub mod mob;
pub mod pacing;
pub mod race_support;

pub mod projection;
