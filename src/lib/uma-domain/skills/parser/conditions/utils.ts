import type { ConditionFilterParams, ICondition, SkillEvalRunner } from '../definitions';
import type { Runner } from '@/lib/uma-domain/runner/types';
import type { RaceParameters } from '@/lib/uma-domain/race/types';
import type { DistributionRandomPolicy } from '@/lib/uma-domain/skills/policies/ActivationSamplePolicy';
import type { CourseData } from '@/lib/uma-domain/course/definitions';
import {
  ErlangRandomPolicy,
  ImmediatePolicy,
  RandomPolicy,
  UniformRandomPolicy
} from '@/lib/uma-domain/skills/policies/ActivationSamplePolicy';
import { CourseService } from '@/modules/data/services/CourseService';
import { calculateEarlyRaceAverageSpeed } from '@/lib/uma-domain/race/spurt-calculator';
import { Region, RegionList } from '@/lib/uma-domain/shared/region';

// K as in SKI combinators
export function kTrue(_: Runner) {
  return true;
}

const defaultRandom: ICondition = {
  samplePolicy: RandomPolicy,
  filterEq: notSupported,
  filterNeq: notSupported,
  filterLt: notSupported,
  filterLte: notSupported,
  filterGt: notSupported,
  filterGte: notSupported
};

const defaultImmediate: ICondition = {
  samplePolicy: ImmediatePolicy,
  filterEq: notSupported,
  filterNeq: notSupported,
  filterLt: notSupported,
  filterLte: notSupported,
  filterGt: notSupported,
  filterGte: notSupported
};

export function immediate(other: Partial<ICondition>): ICondition {
  return { ...defaultImmediate, ...other };
}

export const random = (other: Partial<ICondition>): ICondition => {
  return { ...defaultRandom, ...other };
};

type DistributionRandomPolicyConstructor<TArgs extends Array<unknown>> = new (
  ...args: TArgs
) => DistributionRandomPolicy;

// ive tried various things to make this return a [xRandom,noopXRandom] pair but seem to run into some typescript bugs
// or something
// it doesnt really make sense to me
const distributionRandomFactory = <TArgs extends Array<unknown>>(
  cls: DistributionRandomPolicyConstructor<TArgs>
) => {
  const cache = Object.create(null);

  return (...args: [...clsArgs: TArgs, condition: Partial<ICondition>]) => {
    const condition = args.pop() as Partial<ICondition>;
    const key = args.join(',');

    // we know that after pop() args is just Ts but typescript doesn't, hence the cast

    let policy: DistributionRandomPolicy;
    if (cache[key]) {
      policy = cache[key];
    } else {
      policy = new cls(...(args as unknown as TArgs));
      cache[key] = policy;
    }

    const notSupportedCondition: ICondition = {
      samplePolicy: policy,
      filterEq: notSupported,
      filterNeq: notSupported,
      filterLt: notSupported,
      filterLte: notSupported,
      filterGt: notSupported,
      filterGte: notSupported
    };

    return { ...notSupportedCondition, ...condition };
  };
};

export const erlangRandom = distributionRandomFactory(ErlangRandomPolicy);
export const uniformRandom = distributionRandomFactory(UniformRandomPolicy);

const noopAll: Omit<ICondition, 'samplePolicy'> = {
  filterEq: noop,
  filterNeq: noop,
  filterLt: noop,
  filterLte: noop,
  filterGt: noop,
  filterGte: noop
};

export const noopErlangRandom = (k: number, lambda: number) => {
  return erlangRandom(k, lambda, noopAll);
};

export function notSupported(_params: ConditionFilterParams): never {
  throw new Error('unsupported comparison');
}

function noop(params: ConditionFilterParams) {
  return params.regions;
}

export const noopImmediate: ICondition = {
  ...noopAll,
  samplePolicy: ImmediatePolicy
};

/**
 * Approximates the earliest distance at which a >= time condition can be satisfied,
 * then clips candidate activation regions so static sampling does not get stuck on
 * regions that end before that moment.
 *
 * This is especially important for ImmediatePolicy skills, which only keep the first
 * matching region after static filtering.
 */
export function shiftRegionsForwardByMinTime(params: ConditionFilterParams) {
  const { regions, arg: minTime, course } = params;

  if (minTime <= 0) {
    return regions;
  }

  const avgSpeed = calculateEarlyRaceAverageSpeed(course.distance);
  const minDistance = avgSpeed * minTime;
  const shiftedRegions = new RegionList();

  for (const region of regions) {
    if (region.end <= minDistance) {
      continue;
    }

    if (region.start < minDistance) {
      shiftedRegions.push(new Region(minDistance, region.end));
      continue;
    }

    shiftedRegions.push(region);
  }

  return shiftedRegions;
}

export function noopSectionRandom(start: number, end: number) {
  function sectionRandom(params: ConditionFilterParams) {
    const { regions, course } = params;
    const bounds = new Region(start * (course.distance / 24), end * (course.distance / 24));
    return regions.rmap((r) => r.intersect(bounds));
  }

  return random({
    filterEq: sectionRandom,
    filterNeq: sectionRandom,
    filterLt: sectionRandom,
    filterLte: sectionRandom,
    filterGt: sectionRandom,
    filterGte: sectionRandom
  });
}

export type ValueFilterParams = {
  regions: RegionList;
  runner: SkillEvalRunner;
  extra: RaceParameters;
  course: CourseData;
};

export function valueFilter(getValue: (params: ValueFilterParams) => number) {
  return immediate({
    filterEq({ regions, arg: value, runner, extra, course }: ConditionFilterParams) {
      const check =
        getValue({
          regions,
          runner,
          extra,
          course
        }) == value;

      return check ? regions : new RegionList();
    },
    filterNeq({ regions, arg: value, runner, extra, course }: ConditionFilterParams) {
      const check =
        getValue({
          regions,
          runner,
          extra,
          course
        }) != value;

      return check ? regions : new RegionList();
    },
    filterLt({ regions, arg: value, runner, extra, course }: ConditionFilterParams) {
      const check =
        getValue({
          regions,
          runner,
          extra,
          course
        }) < value;

      return check ? regions : new RegionList();
    },
    filterLte({ regions, arg: value, runner, extra, course }: ConditionFilterParams) {
      const check =
        getValue({
          regions,
          runner,
          extra,
          course
        }) <= value;

      return check ? regions : new RegionList();
    },
    filterGt({ regions, arg: value, runner, extra, course }: ConditionFilterParams) {
      const check =
        getValue({
          regions,
          runner,
          extra,
          course
        }) > value;

      return check ? regions : new RegionList();
    },
    filterGte({ regions, arg: value, runner, extra, course }: ConditionFilterParams) {
      const check =
        getValue({
          regions,
          runner,
          extra,
          course
        }) >= value;

      return check ? regions : new RegionList();
    }
  });
}

export function orderFilter(getPos: (arg: number, n: number) => number) {
  return immediate({
    filterEq(params: ConditionFilterParams) {
      const { regions, arg, extra } = params;

      if (extra.orderRange && extra.numUmas) {
        const pos = getPos(arg, extra.numUmas);
        return pos >= extra.orderRange[0] && pos <= extra.orderRange[1]
          ? regions
          : new RegionList();
      }

      return regions;
    },
    filterNeq(params: ConditionFilterParams) {
      const { regions, arg, extra } = params;

      if (extra.orderRange && extra.numUmas) {
        const pos = getPos(arg, extra.numUmas);

        return pos < extra.orderRange[0] || pos > extra.orderRange[1] ? regions : new RegionList();
      }

      return regions;
    },
    filterLt(params: ConditionFilterParams) {
      const { regions, arg, extra, course } = params;

      if (extra.orderRange && extra.numUmas) {
        if (!(1 <= extra.orderRange[0] && extra.orderRange[0] <= extra.orderRange[1])) {
          throw new Error('Invalid order range');
        }
        // ignore forward order conditions in the last leg (important for e.g. NY Opera unique)
        // however, add some room after the start of last leg so that forward order skills that proc at the
        // beginning of last leg won't proc on backlines
        const end = new Region(CourseService.phaseStart(course.distance, 2) + 100, course.distance);

        const pos = getPos(arg, extra.numUmas);

        return extra.orderRange[0] < pos ? regions : regions.rmap((r) => r.intersect(end));
      }
      return regions;
    },
    filterLte(params: ConditionFilterParams) {
      const { regions, arg, extra, course } = params;

      if (extra.orderRange && extra.numUmas) {
        if (!(1 <= extra.orderRange[0] && extra.orderRange[0] <= extra.orderRange[1])) {
          throw new Error('Invalid order range');
        }

        const end = new Region(CourseService.phaseStart(course.distance, 2) + 100, course.distance);
        const pos = getPos(arg, extra.numUmas);
        return extra.orderRange[0] <= pos ? regions : regions.rmap((r) => r.intersect(end));
      }

      return regions;
    },
    filterGt(params: ConditionFilterParams) {
      const { regions, arg, extra } = params;

      if (extra.orderRange && extra.numUmas) {
        if (!(extra.orderRange[0] <= extra.orderRange[1] && extra.orderRange[1] <= extra.numUmas)) {
          throw new Error('Invalid order range');
        }

        const pos = getPos(arg, extra.numUmas);
        return pos < extra.orderRange[1] ? regions : new RegionList();
      }
      return regions;
    },
    filterGte(params: ConditionFilterParams) {
      const { regions, arg, extra } = params;

      if (extra.orderRange && extra.numUmas) {
        if (!(extra.orderRange[0] <= extra.orderRange[1] && extra.orderRange[1] <= extra.numUmas)) {
          throw new Error('Invalid order range');
        }

        const pos = getPos(arg, extra.numUmas);
        return pos <= extra.orderRange[1] ? regions : new RegionList();
      }
      return regions;
    }
  });
}

export function orderInFilter(rate: number) {
  return immediate({
    filterEq(params: ConditionFilterParams) {
      const { regions, arg: one, extra } = params;

      if (one !== 1) {
        throw new Error('must be order_rate_inXX_continue==1');
      }

      if (extra.orderRange && extra.numUmas) {
        const [start, end] = extra.orderRange;

        if (start < 1 || start > end) {
          throw new Error('Invalid order range');
        }

        const changeRate = Math.round(rate * extra.numUmas);

        return start <= changeRate ? regions : new RegionList();
      }

      return regions;
    }
  });
}

export function orderOutFilter(rate: number) {
  return immediate({
    filterEq(params: ConditionFilterParams) {
      const { regions, arg: one, extra } = params;

      if (one !== 1) {
        throw new Error('must be order_rate_outXX_continue==1');
      }

      if (extra.orderRange && extra.numUmas) {
        if (!(extra.orderRange[0] <= extra.orderRange[1] && extra.orderRange[1] <= extra.numUmas)) {
          throw new Error('Invalid order range');
        }

        return Math.round(rate * extra.numUmas) <= extra.orderRange[1] ? regions : new RegionList();
      }

      return regions;
    }
  });
}
