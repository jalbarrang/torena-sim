import type { RefObject } from 'react';
import { CopyPlus, TrashIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';

import type { IRunnerState } from '../../domain/runner-state';
import { RunnerCardImportMenu } from './import-menu';
import { RunnerCardShareMenu } from './share-menu';

type RunnerCardActionButtonsProps = {
  state: IRunnerState;
  umaName?: string;
  runnerId: string;
  isMobile: boolean;
  showShareButton: boolean;
  shareCardRef: RefObject<HTMLDivElement | null>;
  onReset?: () => void;
  onCopy?: () => void;
  onScreenshotImport: () => void;
  onCodeImport: () => void;
};

export function RunnerCardActionButtons(props: Readonly<RunnerCardActionButtonsProps>) {
  const {
    state,
    umaName,
    runnerId,
    isMobile,
    showShareButton,
    shareCardRef,
    onReset,
    onCopy,
    onScreenshotImport,
    onCodeImport
  } = props;

  return (
    <div className="grid grid-cols-2 gap-2">
      {!isMobile && (
        <RunnerCardImportMenu onScreenshotImport={onScreenshotImport} onCodeImport={onCodeImport} />
      )}

      {runnerId !== 'pacer' && onCopy && (
        <Button onClick={onCopy} size="sm" variant="outline" title="Copy to other runner">
          <CopyPlus />
          <span className="hidden md:inline!">Duplicate</span>
        </Button>
      )}

      {showShareButton && (
        <RunnerCardShareMenu state={state} umaName={umaName} shareCardRef={shareCardRef} />
      )}

      <Button onClick={onReset} title="Reset runner" size="sm">
        <span className="hidden md:inline!">Reset</span>
        <TrashIcon />
      </Button>
    </div>
  );
}
