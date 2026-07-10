import { withDefaultCond } from '../definitions';
import { kTrue } from './utils';
import type { RegionList } from '@/lib/uma-domain/shared/region';
import type { ActivationSamplePolicy } from '@/lib/uma-domain/skills/policies/ActivationSamplePolicy';
import { CornerRandomPolicy } from '@/lib/uma-domain/skills/policies/ActivationSamplePolicy';
import type {
  ApplyParams,
  ConditionFilterParams,
  ICondition,
  Operator,
  OperatorsConfig
} from '../definitions';
import type { DynamicCondition } from '@/lib/uma-domain/skills/skill.types';

class EqOperator implements Operator {
  samplePolicy: ActivationSamplePolicy;

  constructor(
    readonly condition: ICondition,
    readonly argument: number
  ) {
    this.samplePolicy = condition.samplePolicy;
  }

  apply(params: ApplyParams) {
    const condParams: ConditionFilterParams = {
      ...params,
      arg: this.argument
    };
    return withDefaultCond(this.condition.filterEq(condParams));
  }
}

class NeqOperator implements Operator {
  samplePolicy: ActivationSamplePolicy;

  constructor(
    readonly condition: ICondition,
    readonly argument: number
  ) {
    this.samplePolicy = condition.samplePolicy;
  }

  apply(params: ApplyParams) {
    const condParams: ConditionFilterParams = {
      ...params,
      arg: this.argument
    };

    return withDefaultCond(this.condition.filterNeq(condParams));
  }
}

class LtOperator implements Operator {
  samplePolicy: ActivationSamplePolicy;

  constructor(
    readonly condition: ICondition,
    readonly argument: number
  ) {
    this.samplePolicy = condition.samplePolicy;
  }

  apply(params: ApplyParams) {
    const condParams: ConditionFilterParams = {
      ...params,
      arg: this.argument
    };

    return withDefaultCond(this.condition.filterLt(condParams));
  }
}

class LteOperator implements Operator {
  samplePolicy: ActivationSamplePolicy;

  constructor(
    readonly condition: ICondition,
    readonly argument: number
  ) {
    this.samplePolicy = condition.samplePolicy;
  }

  apply(params: ApplyParams) {
    const condParams: ConditionFilterParams = {
      ...params,
      arg: this.argument
    };

    return withDefaultCond(this.condition.filterLte(condParams));
  }
}

class GtOperator implements Operator {
  samplePolicy: ActivationSamplePolicy;

  constructor(
    readonly condition: ICondition,
    readonly argument: number
  ) {
    this.samplePolicy = condition.samplePolicy;
  }

  apply(params: ApplyParams) {
    const condParams: ConditionFilterParams = {
      ...params,
      arg: this.argument
    };

    return withDefaultCond(this.condition.filterGt(condParams));
  }
}

class GteOperator implements Operator {
  samplePolicy: ActivationSamplePolicy;

  constructor(
    readonly condition: ICondition,
    readonly argument: number
  ) {
    this.samplePolicy = condition.samplePolicy;
  }

  apply(params: ApplyParams) {
    const condParams: ConditionFilterParams = {
      ...params,
      arg: this.argument
    };

    return withDefaultCond(this.condition.filterGte(condParams));
  }
}

export class AndOperator implements Operator {
  samplePolicy: ActivationSamplePolicy;

  constructor(
    readonly left: Operator,
    readonly right: Operator
  ) {
    this.samplePolicy = left.samplePolicy.reconcile(right.samplePolicy);
  }

  apply(params: ApplyParams) {
    const [leftval, leftcond] = this.left.apply(params);
    const leftParams: ApplyParams = {
      ...params,
      regions: leftval
    };

    const [rightval, rightcond] = this.right.apply(leftParams);

    if (leftcond === kTrue && rightcond === kTrue) {
      // avoid allocating an unnecessary closure object in the common case of no dynamic conditions
      return [rightval, kTrue] as [RegionList, DynamicCondition];
    }

    return [rightval, (s) => leftcond(s) && rightcond(s)] as [RegionList, DynamicCondition];
  }
}

export class OrOperator implements Operator {
  samplePolicy: ActivationSamplePolicy;

  constructor(
    readonly left: Operator,
    readonly right: Operator
  ) {
    // not entirely clear what the right thing to do here is
    // but i'm pretty sure there are no skills with disjunctive conditions that
    // would have different sample policies (probably)
    this.samplePolicy = left.samplePolicy.reconcile(right.samplePolicy);
  }

  apply(params: ApplyParams): [RegionList, DynamicCondition] {
    const [leftval, leftcond] = this.left.apply(params);
    const [rightval, rightcond] = this.right.apply(params);

    // corner_random branches are order-sensitive. For cases like
    // corner_random==1@corner_random==2, game behavior resolves to the first
    // satisfiable branch rather than sampling from the union of both corners.
    if (
      this.left.samplePolicy === CornerRandomPolicy &&
      this.right.samplePolicy === CornerRandomPolicy &&
      leftcond === kTrue &&
      rightcond === kTrue
    ) {
      const branchRegions = leftval.length > 0 ? leftval : rightval;
      return [branchRegions, kTrue];
    }

    if (leftcond === kTrue && rightcond === kTrue) {
      // avoid allocating an unnecessary closure object in the common case of no dynamic conditions
      return [leftval.union(rightval), kTrue];
    }

    // FIXME this is, technically, completely broken. really the correct way to do this is to tie dynamic conditions to regions
    // and propagate them during union and intersection. however, that's really annoying, and it turns out in practice that
    // dynamic conditions never actually change between branches of an or operator if the static conditions differ, in which case
    // this works out just fine. specifically, it's fine if /either/ the dynamic conditions differ or the static conditions differ
    // between branches, but not both.
    // eg, consider something like phase==0&accumulatetime>=20@phase==1&accumulatetime>=30
    // suppose phase 0 lasts 21 seconds, in which case the left branch would not trigger. the right branch then should not trigger
    // until 30 seconds, but this obviously does because it's broken. conditions like this do not currently appear on any skills.
    // unfortunately, there's not really a way here to assert that leftcond and rightcond are the same.
    // this is rather risky. i don't like it.
    // TODO actually, it's perfectly possible to just inspect the tree to make sure the above limitations are satisfied.
    return [leftval.union(rightval), (s) => leftcond(s) || rightcond(s)];
  }
}

export const defaultOperators: OperatorsConfig<ICondition, Operator> = {
  and: AndOperator,
  or: OrOperator,
  eq: EqOperator,
  neq: NeqOperator,
  lt: LtOperator,
  lte: LteOperator,
  gt: GtOperator,
  gte: GteOperator
};
