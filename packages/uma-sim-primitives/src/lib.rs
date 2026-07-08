//! # uma-sim-primitives
//!
//! Pure shared primitives for the Uma Musume race simulation (ADR-0005).
//!
//! Every item here is a **pure function of already-resolved inputs** or a plain
//! value object — nothing in this crate asks whether a field exists or owns any
//! simulation orchestration. Both purpose-built engines (`uma-sim-race`,
//! `uma-sim-vacuum`) build on top of these.
//!
//! ## Contents
//!
//! - [`shared_kernel`] — cross-context primitives: RNG, IDs, [`Region`](shared_kernel::region),
//!   math value objects, the ubiquitous-language enums, and race parameters.
//! - [`course`] — track-geometry value objects, the phase domain service, and the
//!   speed / acceleration / position-keep coefficient tables (the leaf formulas).
//! - [`skills`] — the skill model + effects, the condition *language* (parser +
//!   static catalog + dynamic predicate registry), activation sampling, and
//!   debuff/recovery resolution. Reads live race state only through the
//!   read-only view traits it defines, never by depending on an engine.
//!
//! - [`stamina`] — HP budget policy (strategy object) + last-spurt domain
//!   service; pure functions of resolved race-state slices.
//! - [`runner`] — the shared `Runner` **state** + the pure per-tick **step
//!   kernel** (`Runner::on_update`) and prepare/init lifecycle. The step
//!   consumes a pre-resolved [`FieldInputs`](runner::physics::FieldInputs);
//!   it never asks whether a real field exists.
//! - [`position_keep`] — the virtual position-keep state machine: pure
//!   functions over a `&mut Runner` plus an engine-built context.
//! - [`projection`] — pure read-model helpers that reconcile per-tick active
//!   effect snapshots into `[start, end]` activation logs.
//!
//! The dependency direction is strictly inward: `skills` may use `course` and
//! `shared_kernel`; `course` may use `shared_kernel`; never the reverse, and
//! none references any engine context.

pub mod shared_kernel;

pub mod course;
pub mod skills;

/// Shared compare-grade telemetry collector used by both race engines.
pub mod compare;

pub mod stamina;

pub mod position_keep;
pub mod runner;

// Field-agnostic race-orchestration support shared by both engines (ADR-0005):
// the observer port + read-model views, pacer selection, and mob field gen.
pub mod events;
pub mod mob;
pub mod pacing;
pub mod race_support;

pub mod projection;
