import type { IRunnerState } from '../components/runner-card/domain/runner-state';
import type { ISavedRunner } from '@/store/runner-library.store';
import { useRunnerLibraryStore } from '@/store/runner-library.store';

export type VeteranImportCandidate = {
  state: IRunnerState;
  notes: string;
};

export function appendVeteransToLibrary(candidates: VeteranImportCandidate[]): number {
  if (candidates.length === 0) return 0;

  const now = Date.now();
  const runners: ISavedRunner[] = candidates.map((candidate, index) => ({
    ...candidate.state,
    notes: candidate.notes,
    id: `${now}-${index}-${Math.random().toString(36).slice(2, 9)}`,
    createdAt: now,
    updatedAt: now
  }));

  useRunnerLibraryStore.setState((state) => ({
    runners: [...state.runners, ...runners]
  }));

  return runners.length;
}
