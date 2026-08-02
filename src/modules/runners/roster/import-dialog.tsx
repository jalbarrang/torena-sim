import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { decodeRoster } from '../share/roster-encoding';
import { ImportRunnerPicker } from './components/import-runner-picker';
import { buildDecodedRunner } from './helpers';
import { appendVeteransToLibrary } from './import-library';
import type { IDecodedRunner } from './types';

type RosterImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type DecodeResult =
  | { code: string; status: 'error'; runners: null }
  | { code: string; status: 'decoded'; runners: IDecodedRunner[] };

type DecodeState =
  | { status: 'idle'; runners: null }
  | { status: 'loading'; runners: null }
  | DecodeResult;

export function RosterImportDialog(props: Readonly<RosterImportDialogProps>) {
  const { open, onOpenChange } = props;
  const [code, setCode] = useState('');
  const [decodeResult, setDecodeResult] = useState<DecodeResult | null>(null);
  const trimmedCode = code.trim();

  useEffect(() => {
    if (!trimmedCode) return;

    let cancelled = false;
    void decodeRoster(trimmedCode).then((result) => {
      if (cancelled) return;
      if (!result || result.length === 0) {
        setDecodeResult({ code: trimmedCode, status: 'error', runners: null });
        return;
      }
      setDecodeResult({
        code: trimmedCode,
        status: 'decoded',
        runners: result.map(buildDecodedRunner)
      });
    });

    return () => {
      cancelled = true;
    };
  }, [trimmedCode]);

  const decodeState: DecodeState = !trimmedCode
    ? { status: 'idle', runners: null }
    : decodeResult?.code === trimmedCode
      ? decodeResult
      : { status: 'loading', runners: null };

  const reset = useCallback(() => {
    setCode('');
    setDecodeResult(null);
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) reset();
      onOpenChange(next);
    },
    [onOpenChange, reset]
  );

  const handleImport = useCallback(
    (runners: IDecodedRunner[]) => {
      const count = appendVeteransToLibrary(
        runners.map((runner) => ({ state: runner.state, notes: 'Imported from RosterView' }))
      );
      toast.success(`Imported ${count} runner${count === 1 ? '' : 's'} to Veterans`);
      handleOpenChange(false);
    },
    [handleOpenChange]
  );

  const sourceContent = (
    <>
      <label htmlFor="rosterview-roster-code" className="text-xs font-medium text-muted-foreground">
        RosterView code
      </label>
      <textarea
        id="rosterview-roster-code"
        className="h-24 w-full resize-none rounded-md border bg-background p-3 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        placeholder="Paste a RosterView roster code..."
        value={code}
        onChange={(event) => setCode(event.target.value)}
      />
    </>
  );

  const hasResults = decodeState.status === 'decoded';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={`max-h-[calc(100dvh-2rem)] overflow-y-auto ${hasResults ? 'max-w-5xl!' : 'max-w-2xl!'}`}
      >
        <DialogHeader>
          <DialogTitle>Import RosterView code</DialogTitle>
          <DialogDescription>
            Paste an encoded roster code, then choose the runners to add to Veterans.
          </DialogDescription>
        </DialogHeader>

        {hasResults ? (
          <ImportRunnerPicker
            key={code}
            runners={decodeState.runners}
            sourceContent={sourceContent}
            onCancel={() => handleOpenChange(false)}
            onImport={handleImport}
          />
        ) : (
          <>
            <div className="flex flex-col gap-3">
              {sourceContent}
              {decodeState.status === 'loading' && (
                <div role="status" className="p-3 text-center text-sm text-muted-foreground">
                  Decoding roster…
                </div>
              )}
              {decodeState.status === 'error' && (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                >
                  This roster code could not be decoded. Check that you copied the complete code.
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
