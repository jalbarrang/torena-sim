import { CheckCircle2 } from 'lucide-react';
import type { ExtractedUmaData } from '@/modules/runners/ocr/types';
import { getIconById } from '@/modules/data/icons';
import { hasDetectedData } from '../helpers';

const SUMMARY_STATS = ['speed', 'stamina', 'power', 'guts', 'wisdom'] as const;

type WizardStepSummaryProps = {
  results: Partial<ExtractedUmaData> | null;
};

export function WizardStepSummary(props: Readonly<WizardStepSummaryProps>) {
  const { results } = props;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
      <div className="rounded-md border p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Import Summary</h3>
          {hasDetectedData(results) && (
            <div className="text-green-600 flex items-center gap-1 text-sm">
              <CheckCircle2 className="size-4" />
              Ready to apply
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Uma</p>
            {results?.outfitId ? (
              <div className="flex items-center gap-2 mt-1">
                <img
                  src={getIconById(results.outfitId)}
                  alt={results.umaName}
                  className="size-10 rounded"
                />
                <div>
                  <p className="font-medium">{results.outfitName}</p>
                  <p className="text-sm text-muted-foreground">{results.umaName}</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground mt-1">Not detected</p>
            )}
          </div>

          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Stats</p>
            <div className="grid grid-cols-5 gap-2 text-center text-sm">
              {SUMMARY_STATS.map((stat) => (
                <div key={stat} className="rounded border p-2">
                  <p className="text-[10px] text-muted-foreground uppercase">{stat.slice(0, 3)}</p>
                  <p className="font-mono">{results?.[stat] ?? '-'}</p>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Skills</p>
            <p className="text-sm mt-1">{results?.skills?.length ?? 0} detected</p>
          </div>
        </div>
      </div>
    </div>
  );
}
