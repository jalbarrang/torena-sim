import { useNavigate } from 'react-router';

import { useState } from 'react';
import { RunnerEditorLayout } from '@/layout/runner-editor-layout';
import { createRunnerState } from '@/modules/runners/components/runner-card/domain/runner-state';
import { useRunnerLibraryStore } from '@/store/runner-library.store';

export default function NewRunnerPage() {
  const navigate = useNavigate();
  const { addRunner } = useRunnerLibraryStore();

  const [runnerName, setRunnerName] = useState('');
  const [runnerState, setRunnerState] = useState(() => createRunnerState());

  const handleSave = () => {
    if (!runnerName.trim()) {
      return;
    }

    addRunner({
      ...runnerState,
      notes: runnerName.trim()
    });

    navigate('/runners');
  };

  const handleCancel = () => {
    navigate('/runners');
  };

  return (
    <RunnerEditorLayout
      runnerName={runnerName}
      runnerState={runnerState}
      onRunnerNameChange={setRunnerName}
      onRunnerStateChange={setRunnerState}
      onSave={handleSave}
      onCancel={handleCancel}
      isEditMode={false}
    />
  );
}
