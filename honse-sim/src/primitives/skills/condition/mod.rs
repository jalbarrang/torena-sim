//! # Skill condition language (sub-domain of `skills`)
//!
//! A small parsed DSL (`phase>=2&order_rate<=50`) that compiles to activation
//! regions plus runtime predicates. Conditions come in two layers:
//!
//! - **static** — narrow the activation [`Region`](crate::shared_kernel::region)
//!   window at skill-setup time.
//! - **dynamic** — closures evaluated each tick against live race state, observed
//!   through the read-only view traits defined here (`RunnerView` / `RaceView`).
//!
//! Keeping the views here is the anti-corruption seam that lets the skills
//! context read racing state without depending on the `racing` module.

pub mod approximate;
pub mod blocking;
pub mod catalog;
pub mod dynamic;
pub mod language;
pub mod operator;
pub mod order;
pub mod proximity;
pub mod state;

use std::collections::HashMap;
use std::sync::Arc;

use crate::course::model::CourseData;
use crate::shared_kernel::language::{Mood, Strategy};
use crate::shared_kernel::params::{RaceParameters, StatLine};
use crate::shared_kernel::region::RegionList;
use crate::skills::activation::{ActivationSamplePolicy, ReconcileError};
use crate::skills::condition::dynamic::DynamicCondition;

/// How a `dynamic_or_static` condition resolves, supplied **explicitly by the
/// engine** at skill-setup time (ADR-0005). This replaces the former
/// `p.extra.mode` read inside the condition: field-presence (live field vs
/// synthetic) is decided by whoever owns the field, and the condition just
/// reacts to the resolved strategy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConditionResolution {
    /// Resolve to a live dynamic predicate evaluated each tick (contested field).
    Dynamic,
    /// Resolve to a static approximate region narrowing at setup time
    /// (synthetic / vacuum field).
    Static,
}

/// Read-only view of a runner used during *static* condition evaluation
/// (skill setup time). Decouples the parser/catalog from the full `Runner`
/// entity — the anti-corruption seam for the skills context.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkillEvalRunner {
    /// Base (pre-adjustment) stats.
    pub base_stats: StatLine,
    /// Running style.
    pub strategy: Strategy,
    /// Motivation.
    pub mood: Mood,
    /// Betting popularity rank (1 = most popular). `0` means unknown/unset and
    /// is treated as "no constraint" by the `popularity` condition.
    pub popularity: i64,
}

/// Parameters passed to a [`Condition`] filter method.
pub struct ConditionFilterParams<'a> {
    /// Candidate activation windows to narrow.
    pub regions: RegionList,
    /// The integer argument from the comparison (`phase>=2` -> `2`).
    pub arg: i64,
    /// The course being raced.
    pub course: &'a CourseData,
    /// Static view of the runner.
    pub runner: &'a SkillEvalRunner,
    /// Race-wide parameters.
    pub extra: &'a RaceParameters,
    /// Engine-supplied condition-resolution strategy.
    pub resolution: ConditionResolution,
}

/// Parameters passed to an [`Operator`]'s `apply`.
pub struct ApplyParams<'a> {
    /// Candidate activation windows to narrow.
    pub regions: RegionList,
    /// The course being raced.
    pub course: &'a CourseData,
    /// Static view of the runner.
    pub runner: &'a SkillEvalRunner,
    /// Race-wide parameters.
    pub extra: &'a RaceParameters,
    /// Engine-supplied condition-resolution strategy.
    pub resolution: ConditionResolution,
}

impl<'a> ApplyParams<'a> {
    /// Build the condition-filter params for this apply context and a comparison
    /// argument.
    pub fn with_arg(&self, arg: i64) -> ConditionFilterParams<'a> {
        ConditionFilterParams {
            regions: self.regions.clone(),
            arg,
            course: self.course,
            runner: self.runner,
            extra: self.extra,
            resolution: self.resolution,
        }
    }

    /// Clone this context with a different region set (used to chain `And`).
    pub fn with_regions(&self, regions: RegionList) -> ApplyParams<'a> {
        ApplyParams {
            regions,
            course: self.course,
            runner: self.runner,
            extra: self.extra,
            resolution: self.resolution,
        }
    }
}

/// The result of filtering/applying: narrowed regions plus an optional dynamic
/// condition. `None` means no runtime gate is needed (`kTrue`).
pub type ConditionResult = (RegionList, Option<DynamicCondition>);

/// Errors raised while applying conditions/operators.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConditionError {
    /// The comparison operator is not supported by this condition.
    Unsupported,
    /// A structural/value invariant was violated (e.g. invalid order range).
    Invalid(&'static str),
    /// Two incompatible sample policies were combined.
    Reconcile(ReconcileError),
}

impl std::fmt::Display for ConditionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConditionError::Unsupported => write!(f, "unsupported comparison"),
            ConditionError::Invalid(msg) => write!(f, "{msg}"),
            ConditionError::Reconcile(err) => write!(f, "{err}"),
        }
    }
}

impl std::error::Error for ConditionError {}

impl From<ReconcileError> for ConditionError {
    fn from(err: ReconcileError) -> Self {
        ConditionError::Reconcile(err)
    }
}

/// A named condition (e.g. `phase`, `order_rate`). Knows its sampling policy and
/// how to filter the candidate regions for each comparison operator.
///
/// Each `filter_*` defaults to [`ConditionError::Unsupported`]; concrete
/// conditions (t-008) override the comparisons they support.
pub trait Condition: Send + Sync {
    /// How this condition samples activation windows.
    fn sample_policy(&self) -> ActivationSamplePolicy;

    /// `cond == arg`.
    fn filter_eq(
        &self,
        _params: &ConditionFilterParams<'_>,
    ) -> Result<ConditionResult, ConditionError> {
        Err(ConditionError::Unsupported)
    }
    /// `cond != arg`.
    fn filter_neq(
        &self,
        _params: &ConditionFilterParams<'_>,
    ) -> Result<ConditionResult, ConditionError> {
        Err(ConditionError::Unsupported)
    }
    /// `cond < arg`.
    fn filter_lt(
        &self,
        _params: &ConditionFilterParams<'_>,
    ) -> Result<ConditionResult, ConditionError> {
        Err(ConditionError::Unsupported)
    }
    /// `cond <= arg`.
    fn filter_lte(
        &self,
        _params: &ConditionFilterParams<'_>,
    ) -> Result<ConditionResult, ConditionError> {
        Err(ConditionError::Unsupported)
    }
    /// `cond > arg`.
    fn filter_gt(
        &self,
        _params: &ConditionFilterParams<'_>,
    ) -> Result<ConditionResult, ConditionError> {
        Err(ConditionError::Unsupported)
    }
    /// `cond >= arg`.
    fn filter_gte(
        &self,
        _params: &ConditionFilterParams<'_>,
    ) -> Result<ConditionResult, ConditionError> {
        Err(ConditionError::Unsupported)
    }
}

/// A parsed operator node (comparison or logical combinator).
pub trait Operator: Send + Sync {
    /// The reconciled sample policy of this (sub)expression.
    fn sample_policy(&self) -> ActivationSamplePolicy;

    /// Apply this operator, narrowing `params.regions` and producing an optional
    /// dynamic condition.
    fn apply(&self, params: &ApplyParams<'_>) -> Result<ConditionResult, ConditionError>;
}

/// Name -> shared condition object, injected into the parser. Populated by the
/// static catalog (t-008).
pub type ConditionCatalog = HashMap<String, Arc<dyn Condition>>;
