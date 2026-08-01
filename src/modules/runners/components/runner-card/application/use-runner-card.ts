import { useCallback, useMemo, useRef } from 'react';

import { getUmaDisplayInfo } from '@/modules/runners/utils';
import type { ExtractedUmaData } from '@/modules/runners/ocr/types';
import { updateCurrentSkills } from '@/modules/skills/store';
import { useIsMobile } from '@/hooks/use-mobile';

import { buildOcrImportState, buildRunnerChangeState } from './runner-state-transitions';
import type { RunnerCardProps, RunnerCardStatKey } from '../runner-card.types';

export function useRunnerCard(props: RunnerCardProps) {
  const { value: state, onChange, courseId } = props;
  const isMobile = useIsMobile();
  const shareCardRef = useRef<HTMLDivElement>(null);

  const umaInfo = useMemo(() => {
    if (!state.outfitId) return null;
    return getUmaDisplayInfo(state.outfitId);
  }, [state.outfitId]);

  const handleOcrImportApply = useCallback(
    (data: ExtractedUmaData) => {
      const { next, syncSkills } = buildOcrImportState(state, data);
      if (syncSkills) updateCurrentSkills(syncSkills);
      onChange(next);
    },
    [onChange, state]
  );

  const handleChangeRunner = useCallback(
    (outfitId: string) => {
      onChange(buildRunnerChangeState(state, outfitId, courseId));
    },
    [courseId, onChange, state]
  );

  const handleUpdateStat = (stat: RunnerCardStatKey) => (value: number) => {
    onChange({ ...state, [stat]: value });
  };

  return {
    state,
    umaInfo,
    isMobile,
    shareCardRef,
    handleOcrImportApply,
    handleChangeRunner,
    handleUpdateStat
  };
}
