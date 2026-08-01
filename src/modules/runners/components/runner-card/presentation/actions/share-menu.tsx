import type { RefObject } from 'react';
import { Camera, ChevronDown, Code, Download, Share2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { copyRosterViewCode, copyScreenshot, downloadJson } from '../../../../share/share-actions';

import type { IRunnerState } from '../../domain/runner-state';

type RunnerCardShareMenuProps = {
  state: IRunnerState;
  umaName?: string;
  shareCardRef: RefObject<HTMLDivElement | null>;
};

export function RunnerCardShareMenu(props: Readonly<RunnerCardShareMenuProps>) {
  const { state, umaName, shareCardRef } = props;

  return (
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
          onClick={() => downloadJson(state, `runner-${umaName ?? 'unknown'}.json`)}
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
  );
}
