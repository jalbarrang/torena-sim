//! # Skills bounded context
//!
//! The skill model, the skill **condition language** (a small parsed DSL), the
//! effect taxonomy, recovery/debuff rules, and the activation-sampling
//! **domain service**.
//!
//! This context observes live race state (for dynamic/approximate conditions)
//! only through read-only view traits declared in [`condition`]; it never
//! depends on the `racing` module directly.

pub mod activated_ledger;
pub mod activation;
pub mod condition;
pub mod debuff;
pub mod effect;
pub mod model;
pub mod recovery;
pub mod value_scaling;
