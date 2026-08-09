//! Comparison and logical operators (`Eq`/`Lt`/…/`And`/`Or`) produced by the
//! parser; each knows how to `apply` itself to a region set.
//!
//! Ports `parser/conditions/operators.ts`. The TypeScript `kTrue` identity check
//! becomes an `Option::is_none` check (`None` == no dynamic condition).

use std::sync::Arc;

use crate::skills::activation::ActivationSamplePolicy;
use crate::skills::condition::dynamic::{eval_dynamic, DynamicCondition};
use crate::skills::condition::{ApplyParams, Condition, ConditionError, ConditionResult, Operator};

/// The six comparison kinds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CmpKind {
    /// `==`
    Eq,
    /// `!=`
    Neq,
    /// `<`
    Lt,
    /// `<=`
    Lte,
    /// `>`
    Gt,
    /// `>=`
    Gte,
}

/// A comparison operator: `condition <cmp> argument`.
pub struct CmpOperator {
    condition: Arc<dyn Condition>,
    argument: i64,
    kind: CmpKind,
}

impl CmpOperator {
    /// Build a comparison operator.
    pub fn new(condition: Arc<dyn Condition>, argument: i64, kind: CmpKind) -> Self {
        CmpOperator {
            condition,
            argument,
            kind,
        }
    }
}

impl Operator for CmpOperator {
    fn sample_policy(&self) -> ActivationSamplePolicy {
        self.condition.sample_policy()
    }

    fn apply(&self, params: &ApplyParams<'_>) -> Result<ConditionResult, ConditionError> {
        let cond_params = params.with_arg(self.argument);
        match self.kind {
            CmpKind::Eq => self.condition.filter_eq(&cond_params),
            CmpKind::Neq => self.condition.filter_neq(&cond_params),
            CmpKind::Lt => self.condition.filter_lt(&cond_params),
            CmpKind::Lte => self.condition.filter_lte(&cond_params),
            CmpKind::Gt => self.condition.filter_gt(&cond_params),
            CmpKind::Gte => self.condition.filter_gte(&cond_params),
        }
    }
}

/// Logical AND: apply `left`, then `right` over the narrowed regions.
pub struct AndOperator {
    left: Box<dyn Operator>,
    right: Box<dyn Operator>,
    sample_policy: ActivationSamplePolicy,
}

impl AndOperator {
    /// Build an AND node, reconciling the children's sample policies (may fail
    /// if they are incompatible).
    pub fn new(left: Box<dyn Operator>, right: Box<dyn Operator>) -> Result<Self, ConditionError> {
        let sample_policy = left.sample_policy().reconcile(right.sample_policy())?;
        Ok(AndOperator {
            left,
            right,
            sample_policy,
        })
    }
}

impl Operator for AndOperator {
    fn sample_policy(&self) -> ActivationSamplePolicy {
        self.sample_policy
    }

    fn apply(&self, params: &ApplyParams<'_>) -> Result<ConditionResult, ConditionError> {
        let (left_regions, left_cond) = self.left.apply(params)?;
        let right_params = params.with_regions(left_regions);
        let (right_regions, right_cond) = self.right.apply(&right_params)?;

        if left_cond.is_none() && right_cond.is_none() {
            // Common case: no dynamic conditions, avoid allocating a closure.
            return Ok((right_regions, None));
        }

        let combined = DynamicCondition::new(move |runner| {
            eval_dynamic(&left_cond, runner) && eval_dynamic(&right_cond, runner)
        });
        Ok((right_regions, Some(combined)))
    }
}

/// Logical OR: union of the two branches (with a corner-random special case).
pub struct OrOperator {
    left: Box<dyn Operator>,
    right: Box<dyn Operator>,
    sample_policy: ActivationSamplePolicy,
}

impl OrOperator {
    /// Build an OR node, reconciling the children's sample policies.
    pub fn new(left: Box<dyn Operator>, right: Box<dyn Operator>) -> Result<Self, ConditionError> {
        let sample_policy = left.sample_policy().reconcile(right.sample_policy())?;
        Ok(OrOperator {
            left,
            right,
            sample_policy,
        })
    }
}

impl Operator for OrOperator {
    fn sample_policy(&self) -> ActivationSamplePolicy {
        self.sample_policy
    }

    fn apply(&self, params: &ApplyParams<'_>) -> Result<ConditionResult, ConditionError> {
        let (left_regions, left_cond) = self.left.apply(params)?;
        let (right_regions, right_cond) = self.right.apply(params)?;

        // corner_random branches are order-sensitive: resolve to the first
        // satisfiable branch rather than sampling the union of both corners.
        let both_corner_random = self.left.sample_policy() == ActivationSamplePolicy::CornerRandom
            && self.right.sample_policy() == ActivationSamplePolicy::CornerRandom;
        if both_corner_random && left_cond.is_none() && right_cond.is_none() {
            let branch = if !left_regions.0.is_empty() {
                left_regions
            } else {
                right_regions
            };
            return Ok((branch, None));
        }

        let union = left_regions.union(&right_regions);
        if left_cond.is_none() && right_cond.is_none() {
            return Ok((union, None));
        }
        let combined = DynamicCondition::new(move |runner| {
            eval_dynamic(&left_cond, runner) || eval_dynamic(&right_cond, runner)
        });
        Ok((union, Some(combined)))
    }
}
