import { useMemo } from 'react';
import type { RefObject } from 'react';

import { getUmaImageUrl } from '@/modules/runners/utils';
import { getSkillsForShareCard } from '../../../share/share-actions';
import { ShareCard } from '../../../share/share-card';

import type { IRunnerState } from '../domain/runner-state';

type RunnerCardSharePreviewProps = {
  shareCardRef: RefObject<HTMLDivElement | null>;
  state: IRunnerState;
  umaInfo: React.ComponentProps<typeof ShareCard>['umaInfo'];
};

export function RunnerCardSharePreview(props: Readonly<RunnerCardSharePreviewProps>) {
  const { shareCardRef, state, umaInfo } = props;
  const imageUrl = useMemo(
    () => getUmaImageUrl(state.outfitId, state.randomMobId),
    [state.outfitId, state.randomMobId]
  );
  const skills = useMemo(() => getSkillsForShareCard(state.skills), [state.skills]);

  return (
    <div style={{ position: 'absolute', left: -9999, top: 0 }}>
      <ShareCard
        ref={shareCardRef}
        runner={state}
        umaInfo={umaInfo}
        imageUrl={imageUrl}
        skills={skills}
      />
    </div>
  );
}
