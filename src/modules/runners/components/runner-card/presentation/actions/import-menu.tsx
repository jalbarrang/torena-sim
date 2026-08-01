import { ChevronDown, ClipboardPaste, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';

type RunnerCardImportMenuProps = {
  onScreenshotImport: () => void;
  onCodeImport: () => void;
};

export function RunnerCardImportMenu(props: Readonly<RunnerCardImportMenuProps>) {
  const { onScreenshotImport, onCodeImport } = props;

  return (
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
        <DropdownMenuItem onClick={onScreenshotImport}>
          <Upload className="size-4 mr-2" />
          From Screenshot (OCR)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onCodeImport}>
          <ClipboardPaste className="size-4 mr-2" />
          From Code
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
