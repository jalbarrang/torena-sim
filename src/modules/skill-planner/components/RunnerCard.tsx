import { useState } from 'react';
import { Import } from 'lucide-react';
import type { StatsKey } from '@/modules/runners/components/runner-card/presentation/stats-table';
import type { IRunnerState } from '@/modules/runners/components/runner-card/domain/runner-state';
import { cn } from '@/lib/utils';
import { StatsTable } from '@/modules/runners/components/runner-card/presentation/stats-table';
import { UmaSelector } from '@/modules/runners/components/runner-selector';
import { AptitudeBucketsField } from '@/modules/runners/components/aptitude-buckets-field';
import { useSettingsStore } from '@/store/settings.store';
import { ImportVeteranDialog } from './ImportVeteranDialog';
import { Button } from '@/components/ui/button';

type RunnerCardProps = {
  value: IRunnerState;
  onChange: (runner: Partial<IRunnerState>) => void;
  onReset: () => void;
  onImportVeteran?: (runner: IRunnerState) => void;
  className?: string;
};

export const RunnerCard = (props: RunnerCardProps) => {
  const { value, onChange, onReset, onImportVeteran, className, ...rest } = props;
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const courseId = useSettingsStore((state) => state.courseId);

  const handleUpdateOutfitId = (outfitId: string) => {
    onChange({ outfitId });
  };

  const handleUpdateStat = (stat: StatsKey) => (newValue: number) => {
    onChange({ [stat]: newValue });
  };

  const handleUpdateAptitude = (runnerState: IRunnerState) => {
    onChange(runnerState);
  };

  const handleResetRunner = () => {
    onReset();
  };

  return (
    <>
      <ImportVeteranDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        onImportRunner={(runner) => onImportVeteran?.(runner)}
      />

      <div className={cn('flex flex-col gap-4', className)} {...rest}>
        <div className="flex flex-col md:flex-row gap-4">
          <UmaSelector
            value={value.outfitId}
            select={handleUpdateOutfitId}
            onReset={() => handleUpdateOutfitId('')}
          />

          <div className="flex flex-col shrink-0 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setImportDialogOpen(true)}
              disabled={!onImportVeteran}
            >
              <Import className="mr-2" />
              Import from Veterans
            </Button>

            <Button variant="outline" size="sm" onClick={handleResetRunner}>
              Reset Runner
            </Button>
          </div>
        </div>

        <StatsTable value={value} onChange={handleUpdateStat} />

        <AptitudeBucketsField value={value} onChange={handleUpdateAptitude} courseId={courseId} />
      </div>
    </>
  );
};
