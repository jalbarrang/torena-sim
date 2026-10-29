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
    compare, compare_summary, course, events, mob, pacing, position_keep, projection, race_support,
    readouts, runner, shared_kernel, skill_bashin, skills, spot_struggle, stamina,
};

pub mod contested;
pub mod vacuum;

pub use contested::{
    run_contested_compare, run_contested_compare_rounds, run_contested_compare_summarized,
    run_race_sim,
};
pub use vacuum::{
    run_compare, run_compare_rounds, run_compare_summarized, run_paired_compare_rounds,
    run_paired_compare_summarized,
};
