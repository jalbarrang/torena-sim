import { useComparePairRunners } from '@/store/runners.store';
import { getUmaDisplayInfo } from '@/modules/runners/utils';
import type { IRunnerState } from '@/modules/runners/components/runner-card/domain/runner-state';

const COMPARE_A_FALLBACK = 'Compare A';
const COMPARE_B_FALLBACK = 'Compare B';

const displayName = (runner: IRunnerState | undefined, fallback: string): string => {
  if (!runner?.outfitId) return fallback;
  return getUmaDisplayInfo(runner.outfitId)?.name ?? fallback;
};

/**
 * Display names for the compare pair (`uma1` = slot A, `uma2` = slot B),
 * falling back to "Compare A" / "Compare B" when a slot has no uma selected.
 */
export const useComparePairNames = (): { uma1: string; uma2: string } => {
  const { uma1, uma2 } = useComparePairRunners();
  return {
    uma1: displayName(uma1, COMPARE_A_FALLBACK),
    uma2: displayName(uma2, COMPARE_B_FALLBACK)
  };
};
