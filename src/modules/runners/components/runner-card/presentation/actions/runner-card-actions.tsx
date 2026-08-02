import { useState } from 'react';
import type { RefObject } from 'react';

import { OcrImportDialog } from '@/modules/runners/components/ocr-import-dialog';
import { UmaSelector } from '@/modules/runners/components/runner-selector';
import type { ExtractedUmaData } from '@/modules/runners/ocr/types';
import type { IRunnerState } from '../../domain/runner-state';
import { RunnerCardActionButtons } from './action-buttons';

type RunnerCardActionsProps = {
  state: IRunnerState;
  umaId: string;
  umaInfo: { name: string; outfit: string } | null;
  runnerId: string;
  isMobile: boolean;
  showShareButton: boolean;
  shareCardRef: RefObject<HTMLDivElement | null>;
  onChangeRunner: (outfitId: string) => void;
  onReset?: () => void;
  onCopy?: () => void;
  onOcrApply: (data: ExtractedUmaData) => void;
};

export function RunnerCardActions(props: Readonly<RunnerCardActionsProps>) {
  const { state, umaId, umaInfo } = props;
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  return (
    <>
      <div className="flex gap-2">
        <UmaSelector
          value={umaId}
          select={props.onChangeRunner}
          onReset={props.onReset}
          onImport={() => setImportDialogOpen(true)}
          randomMobId={state.randomMobId}
        />
        <RunnerCardActionButtons
          state={state}
          umaName={umaInfo?.name}
          runnerId={props.runnerId}
          isMobile={props.isMobile}
          showShareButton={props.showShareButton}
          shareCardRef={props.shareCardRef}
          onReset={props.onReset}
          onCopy={props.onCopy}
          onScreenshotImport={() => setImportDialogOpen(true)}
        />
      </div>

      <OcrImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        onApply={props.onOcrApply}
      />
    </>
  );
}
