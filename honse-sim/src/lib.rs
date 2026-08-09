//! Deterministic Uma Musume race simulation.
//!
//! The crate exposes shared mechanics at the root and through [`primitives`].
//! The [`contested`] module owns live-field race orchestration. The [`vacuum`]
//! module owns synthetic comparison orchestration. Both engines use the same
//! runner step kernel.

// Keep the original internal import paths valid while the former primitives
// crate is compiled as a module of this facade.
extern crate self as uma_sim_primitives;

pub mod primitives;

// Preserve the primitives crate's public module surface at the facade root.
pub use primitives::{
    compare, course, events, mob, pacing, position_keep, projection, race_support, runner,
    shared_kernel, skills, stamina,
};

pub mod contested;
pub mod vacuum;

pub use contested::{run_contested_compare, run_race_sim};
pub use vacuum::run_compare;
