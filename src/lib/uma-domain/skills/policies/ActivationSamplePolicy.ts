import type { RegionList } from '@/lib/uma-domain/shared/region';
import type { PRNG } from '@/lib/uma-domain/shared/random';
import { Region } from '@/lib/uma-domain/shared/region';

export interface ActivationSamplePolicy {
  sample: (regions: RegionList, nsamples: number, rng: PRNG) => Array<Region>;

  // essentially, when two conditions are combined with an AndOperator one should take precedence over the other
  // immediate transitions into anything and straight_random/all_corner_random dominate everything except each other
  // NB. currently there are no skills that combine straight_random or all_corner_random with anything other than
  // immediate conditions (running_style or distance_type), and obviously they are mutually exclusive with each other
  // the actual x_random (phase_random, down_slope_random, etc) ones should dominate the ones that are not actually
  // random but merely modeled with a probability distribution
  // use smalltalk-style double dispatch to implement the transitions
  reconcile: (other: ActivationSamplePolicy) => ActivationSamplePolicy;
  reconcileImmediate: (other: ActivationSamplePolicy) => ActivationSamplePolicy;
  reconcileDistributionRandom: (other: ActivationSamplePolicy) => ActivationSamplePolicy;
  reconcileRandom: (other: ActivationSamplePolicy) => ActivationSamplePolicy;
  reconcileStraightRandom: (other: ActivationSamplePolicy) => ActivationSamplePolicy;
  reconcileAllCornerRandom: (other: ActivationSamplePolicy) => ActivationSamplePolicy;
}

export const ImmediatePolicy = {
  sample(regions: RegionList, _0: number, _1: PRNG) {
    return regions.slice(0, 1);
  },
  reconcile(other: ActivationSamplePolicy) {
    return other.reconcileImmediate(this);
  },
  reconcileImmediate(other: ActivationSamplePolicy) {
    return other;
  },
  reconcileDistributionRandom(other: ActivationSamplePolicy) {
    return other;
  },
  reconcileRandom(other: ActivationSamplePolicy) {
    return other;
  },
  reconcileStraightRandom(other: ActivationSamplePolicy) {
    return other;
  },
  reconcileAllCornerRandom(other: ActivationSamplePolicy) {
    return other;
  }
};

export const RandomPolicy = {
  sample(regions: RegionList, nsamples: number, rng: PRNG) {
    if (regions.length == 0) {
      return [];
    }
    let acc = 0;
    const weights = regions.map((r) => (acc += r.end - r.start));
    const samples = [];
    for (let i = 0; i < nsamples; ++i) {
      const threshold = rng.uniform(acc);
      const region = regions.find((_, i) => weights[i] > threshold)!;
      samples.push(region.start + rng.uniform(region.end - region.start - 10));
    }
    return samples.map((pos) => new Region(pos, pos + 10));
  },
  reconcile(other: ActivationSamplePolicy) {
    return other.reconcileRandom(this);
  },
  reconcileImmediate(_: ActivationSamplePolicy) {
    return this;
  },
  reconcileDistributionRandom(_other: ActivationSamplePolicy) {
    return this;
  },
  reconcileRandom(other: ActivationSamplePolicy) {
    return other;
  },
  reconcileStraightRandom(other: ActivationSamplePolicy) {
    return other;
  },
  reconcileAllCornerRandom(other: ActivationSamplePolicy) {
    return other;
  }
};

/**
 * Mirrors RandomPolicy sampling, but is distinguishable at parse-time so `@` branches
 * can preserve corner_random branch priority (first satisfiable branch wins).
 */
export const CornerRandomPolicy = {
  sample(regions: RegionList, nsamples: number, rng: PRNG) {
    if (regions.length == 0) {
      return [];
    }
    let acc = 0;
    const weights = regions.map((r) => (acc += r.end - r.start));
    const samples = [];
    for (let i = 0; i < nsamples; ++i) {
      const threshold = rng.uniform(acc);
      const region = regions.find((_, i) => weights[i] > threshold)!;
      samples.push(region.start + rng.uniform(region.end - region.start - 10));
    }
    return samples.map((pos) => new Region(pos, pos + 10));
  },
  reconcile(other: ActivationSamplePolicy) {
    return other.reconcileRandom(this);
  },
  reconcileImmediate(_: ActivationSamplePolicy) {
    return this;
  },
  reconcileDistributionRandom(_other: ActivationSamplePolicy) {
    return this;
  },
  reconcileRandom(other: ActivationSamplePolicy) {
    return other;
  },
  reconcileStraightRandom(other: ActivationSamplePolicy) {
    return other;
  },
  reconcileAllCornerRandom(other: ActivationSamplePolicy) {
    return other;
  }
};

export abstract class DistributionRandomPolicy {
  abstract distribution(upper: number, nsamples: number, rng: PRNG): Array<number>;

  sample(regions: RegionList, nsamples: number, rng: PRNG) {
    if (regions.length == 0) {
      return [];
    }
    const range = regions.reduce((acc, r) => acc + r.end - r.start, 0);
    const regionsSorted = regions.toSorted((a, b) => a.start - b.start);
    const randoms = this.distribution(range, nsamples, rng);
    const samples = [];

    for (let i = 0; i < nsamples; ++i) {
      let pos = randoms[i];

      for (let j = 0; ; j++) {
        pos += regionsSorted[j].start;

        if (pos > regionsSorted[j].end) {
          pos -= regionsSorted[j].end;
          continue;
        }

        samples.push(new Region(pos, regionsSorted[j].end));
        break;
      }
    }
    return samples;
  }

  reconcile(other: ActivationSamplePolicy) {
    return other.reconcileDistributionRandom(this);
  }

  reconcileImmediate(_: ActivationSamplePolicy) {
    return this;
  }

  reconcileDistributionRandom(_: ActivationSamplePolicy) {
    // this is, strictly speaking, probably not the right thing to do
    // probably this should be the joint probability distribution of `this` and `other`, but that is too complex to implement
    // TODO this is something of a stopgap measure anyway, since eventually we'd like to model most of the conditions that use
    // DistributionRandomPolicy with dynamic conditions using a Poisson process or something, which would make this obsolete
    // (this would also enable other features like cooldowns for distribution-random skills).
    return this;
  }
  // this is probably not exactly the right thing to do either, but the true random conditions do need to place a fixed trigger
  // statically ahead of time, uninfluenced by us. this means that the only alternatives are 1) this condition is coincidentally
  // fulfilled during the static random trigger or 2) the skill does not activate at all.
  // since the latter is not particularly interesting, it's safe to just ignore this sample policy and use only the true random one.
  reconcileRandom(other: ActivationSamplePolicy) {
    return other;
  }
  reconcileStraightRandom(other: ActivationSamplePolicy) {
    return other;
  }
  reconcileAllCornerRandom(other: ActivationSamplePolicy) {
    return other;
  }
}

export class UniformRandomPolicy extends DistributionRandomPolicy {
  constructor() {
    super();
  }

  distribution(upper: number, nsamples: number, rng: PRNG) {
    const nums = [];
    for (let i = 0; i < nsamples; ++i) {
      nums.push(rng.uniform(upper));
    }
    return nums;
  }
}

export class ErlangRandomPolicy extends DistributionRandomPolicy {
  constructor(
    readonly k: number,
    readonly lambda: number
  ) {
    super();
  }

  distribution(upper: number, nsamples: number, rng: PRNG) {
    const nums = [];
    let min = Infinity,
      max = 0.0;
    for (let i = 0; i < nsamples; ++i) {
      let u = 1.0;
      for (let j = 0; j < this.k; ++j) {
        u *= rng.random();
      }
      const n = -Math.log(u) / this.lambda;
      min = Math.min(min, n);
      max = Math.max(max, n);
      nums.push(n);
    }
    if (nsamples == 1) {
      const scale = 18;
      return nums.map((n) => Math.floor(upper * Math.min(n / scale, 1.0)));
    }
    const range = max - min;
    return nums.map((n) => Math.floor((upper * (n - min)) / range));
  }
}

export const StraightRandomPolicy = {
  sample(regions: RegionList, nsamples: number, rng: PRNG) {
    // regular RandomPolicy weights regions by their length, so any given point has an equal chance to be chosen across all regions
    // StraightRandomPolicy first picks a region with equal chance regardless of length, and then picks a random point on that region
    if (regions.length == 0) {
      return [];
    }
    const samples = [];
    for (let i = 0; i < nsamples; ++i) {
      const r = regions[rng.uniform(regions.length)];
      samples.push(r.start + rng.uniform(r.end - r.start - 10));
    }
    return samples.map((pos) => new Region(pos, pos + 10));
  },
  reconcile(other: ActivationSamplePolicy) {
    return other.reconcileStraightRandom(this);
  },
  reconcileImmediate(_: ActivationSamplePolicy) {
    return this;
  },
  reconcileDistributionRandom(_: ActivationSamplePolicy) {
    return this;
  },
  reconcileRandom(_: ActivationSamplePolicy) {
    return this;
  },
  reconcileStraightRandom(other: ActivationSamplePolicy) {
    return other;
  },
  reconcileAllCornerRandom(_: ActivationSamplePolicy) {
    throw new Error('cannot reconcile StraightRandomPolicy with AllCornerRandomPolicy');
  }
};

export const AllCornerRandomPolicy = {
  placeTriggers(regions: RegionList, rng: PRNG) {
    const triggers = [];

    const regionCandidates = regions.toSorted((a, b) => a.start - b.start);

    while (triggers.length < 4 && regionCandidates.length > 0) {
      const candidateIndex = rng.uniform(regionCandidates.length);

      const regionCandidate = regionCandidates[candidateIndex];
      const start =
        regionCandidate.start + rng.uniform(regionCandidate.end - regionCandidate.start - 10);

      // note that as each corner's end cannot come after the start of the next corner, this maintains that the candidates
      // are sorted by start
      if (start + 20 <= regionCandidate.end) {
        regionCandidates.splice(candidateIndex, 1, new Region(start + 10, regionCandidate.end));
      } else {
        regionCandidates.splice(candidateIndex, 1);
      }

      regionCandidates.splice(0, candidateIndex); // everything before this corner in the array is guaranteed to be before it in distance
      triggers.push(start);
    }

    // TODO support multiple triggers for skills with cooldown
    return new Region(triggers[0], triggers[0] + 10); // guaranteed to be the earliest trigger since each trigger is placed after the last one
  },

  sample(regions: RegionList, nsamples: number, rng: PRNG) {
    const samples = [];
    for (let i = 0; i < nsamples; ++i) {
      samples.push(this.placeTriggers(regions, rng));
    }
    return samples;
  },
  reconcile(other: ActivationSamplePolicy) {
    return other.reconcileAllCornerRandom(this);
  },
  reconcileImmediate(_: ActivationSamplePolicy) {
    return this;
  },
  reconcileDistributionRandom(_: ActivationSamplePolicy) {
    return this;
  },
  reconcileRandom(_: ActivationSamplePolicy) {
    return this;
  },
  reconcileStraightRandom(_: ActivationSamplePolicy) {
    throw new Error('cannot reconcile StraightRandomPolicy with AllCornerRandomPolicy');
  },
  reconcileAllCornerRandom(_: ActivationSamplePolicy) {
    return this;
  }
};
