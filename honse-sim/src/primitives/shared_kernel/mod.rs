//! # Shared kernel
//!
//! Cross-context primitives shared by every bounded context. These are the
//! foundational value objects and the ubiquitous-language vocabulary. Nothing
//! here knows about races, runners, or skills.

pub mod ids;
pub mod language;
pub mod math;
pub mod params;
pub mod region;
pub mod rng;
