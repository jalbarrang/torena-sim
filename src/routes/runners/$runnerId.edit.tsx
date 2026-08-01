import { useNavigate, useParams } from 'react-router';

import { useMemo, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import type { IRunnerState } from '@/modules/runners/components/runner-card/domain/runner-state';
import { RunnerEditorLayout } from '@/layout/runner-editor-layout';
import { useRunnerLibraryStore } from '@/store/runner-library.store';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';
import { Button } from '@/components/ui/button';

export default function EditRunnerPage() {
  const navigate = useNavigate();
  const { runnerId: id } = useParams();
  const { getRunner, updateRunner } = useRunnerLibraryStore();

  // Get the runner from the store
  const initialRunner = useMemo(() => {
    if (!id) return null;
    return getRunner(id);
  }, [id, getRunner]);

  const [runnerName, setRunnerName] = useState(initialRunner?.notes || '');
  const [runnerState, setRunnerState] = useState<IRunnerState | null>(initialRunner || null);

  const notFound = !initialRunner;

  const handleSave = () => {
    if (!runnerName.trim() || !id || !runnerState) {
      return;
    }

    updateRunner(id, {
      ...runnerState,
      notes: runnerName.trim()
    });

    navigate('/runners');
  };

  const handleCancel = () => {
    navigate('/runners');
  };

  if (notFound) {
    return (
      <div className="flex flex-col flex-1 items-center justify-center p-4">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <AlertCircle />
            </EmptyMedia>
            <EmptyTitle>Runner Not Found</EmptyTitle>
            <EmptyDescription>
              The runner you're trying to edit could not be found.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => navigate('/runners')}>Back to Runners</Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  if (!runnerState) {
    return (
      <div className="flex flex-col flex-1 items-center justify-center p-4">
        <div className="text-muted-foreground">Loading…</div>
      </div>
    );
  }

  return (
    <RunnerEditorLayout
      runnerName={runnerName}
      runnerState={runnerState}
      onRunnerNameChange={setRunnerName}
      onRunnerStateChange={setRunnerState}
      onSave={handleSave}
      onCancel={handleCancel}
      isEditMode={true}
    />
  );
}
