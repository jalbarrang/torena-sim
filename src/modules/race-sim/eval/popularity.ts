import type { IRunnerState } from '@/modules/runners/components/runner-card/domain/runner-state';
import { estimateRunnerRankScore } from './rank-score';

/**
 * Assign a betting popularity rank (1 = most popular) to every runner in the
 * field.
 *
 * The game's popularity (人気) order is driven by the fan-favorite / strength
 * evaluation, which we approximate with each runner's rank score (the imported
 * `rankScore` when present, else `estimateRunnerRankScore`). Runners are sorted
 * by score descending and assigned ranks `1..N`.
 *
 * A manual per-runner override (`IRunnerState.popularity`) wins: any runner with
 * a valid explicit rank keeps it, and the remaining runners fill the unused
 * ranks in score order. Returns ranks aligned to the input array order.
 */
export function computeFieldPopularity(runners: ReadonlyArray<IRunnerState>): number[] {
  const n = runners.length;
  const result = Array.from({ length: n }, () => 0);
  const taken = new Set<number>();

  for (const [index, runner] of runners.entries()) {
    const override = runner.popularity;
    if (
      typeof override === 'number' &&
      Number.isInteger(override) &&
      override >= 1 &&
      override <= n &&
      !taken.has(override)
    ) {
      result[index] = override;
      taken.add(override);
    }
  }

  const remaining = runners
    .map((_, index) => index)
    .filter((index) => result[index] === 0)
    .sort((a, b) => estimateRunnerRankScore(runners[b]) - estimateRunnerRankScore(runners[a]));

  let nextRank = 1;
  for (const index of remaining) {
    while (taken.has(nextRank)) nextRank++;
    result[index] = nextRank;
    taken.add(nextRank);
    nextRank++;
  }

  return result;
}
