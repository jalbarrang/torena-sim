import { useState } from 'react';
import type { RefObject } from 'react';
import {
  Camera,
  ChevronDown,
  ClipboardPaste,
  Code,
  CopyPlus,
  Download,
  Share2,
  TrashIcon,
  Upload
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { getUmaDisplayInfo } from '@/modules/runners/utils';
import { UmaSelector } from '@/modules/runners/components/runner-selector';
import { OcrImportDialog } from '@/modules/runners/components/ocr-import-dialog';
import type { ExtractedUmaData } from '@/modules/runners/ocr/types';
import { copyRosterViewCode, copyScreenshot, downloadJson } from '../../share/share-actions';
import { ImportCodeDialog } from '../../share/import-code-dialog';

import type { IRunnerState } from './types';

type RunnerCardActionsProps = {
  state: IRunnerState;
  umaId: string;
  umaInfo: ReturnType<typeof getUmaDisplayInfo> | null;
  runnerId: string;
  isMobile: boolean;
  showShareButton: boolean;
  shareCardRef: RefObject<HTMLDivElement | null>;
  onChange: (value: IRunnerState) => void;
  onChangeRunner: (outfitId: string) => void;
  onReset?: () => void;
  onCopy?: () => void;
  onOcrApply: (data: ExtractedUmaData) => void;
};

export function RunnerCardActions(props: Readonly<RunnerCardActionsProps>) {
  const {
    state,
    umaId,
    umaInfo,
    runnerId,
    isMobile,
    showShareButton,
    shareCardRef,
    onChange,
    onChangeRunner,
    onReset,
    onCopy,
    onOcrApply
  } = props;

  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [codeImportDialogOpen, setCodeImportDialogOpen] = useState(false);

  return (
    <>
      <div className="flex gap-2">
        <UmaSelector
          value={umaId}
          select={onChangeRunner}
          onReset={onReset}
          onImport={() => setImportDialogOpen(true)}
          randomMobId={state.randomMobId}
        />

        <div className="grid grid-cols-2 gap-2">
          {!isMobile && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button size="sm" variant="outline">
                    <Upload />
                    <span className="hidden md:inline!">Import</span>
                    <ChevronDown />
                  </Button>
                }
              />
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={() => setImportDialogOpen(true)}>
                  <Upload className="size-4 mr-2" />
                  From Screenshot (OCR)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setCodeImportDialogOpen(true)}>
                  <ClipboardPaste className="size-4 mr-2" />
                  From Code
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {runnerId !== 'pacer' && onCopy && (
            <Button onClick={onCopy} size="sm" variant="outline" title="Copy to other runner">
              <CopyPlus />
              <span className="hidden md:inline!">Duplicate</span>
            </Button>
          )}

          {showShareButton && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button size="sm" variant="outline" title="Share runner">
                    <Share2 />
                    <span className="hidden md:inline!">Share</span>
                    <ChevronDown />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => copyRosterViewCode(state)}>
                  <Code className="size-4 mr-2" />
                  Copy RosterView Code
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => downloadJson(state, `runner-${umaInfo?.name ?? 'unknown'}.json`)}
                >
                  <Download className="size-4 mr-2" />
                  Download JSON
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    if (shareCardRef.current) copyScreenshot(shareCardRef.current);
                  }}
                >
                  <Camera className="size-4 mr-2" />
                  Copy Screenshot
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <Button onClick={onReset} title="Reset runner" size="sm">
            <span className="hidden md:inline!">Reset</span>
            <TrashIcon />
          </Button>
        </div>
      </div>

      <OcrImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        onApply={onOcrApply}
      />

      <ImportCodeDialog
        open={codeImportDialogOpen}
        onOpenChange={setCodeImportDialogOpen}
        mode="direct-import"
        onDirectImport={(partialRunner) => {
          onChange({ ...state, ...partialRunner } as IRunnerState);
          setCodeImportDialogOpen(false);
        }}
      />
    </>
  );
}
