import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { toast } from 'sonner';
import { cloneDeep } from 'es-toolkit';
import type { IRunnerState } from '@/modules/runners/components/runner-card/domain/runner-state';

export type ISavedRunner = IRunnerState & {
  id: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
};

type IRunnerLibraryStore = {
  runners: Array<ISavedRunner>;
  addRunner: (runner: Omit<ISavedRunner, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateRunner: (id: string, updates: Partial<ISavedRunner>) => void;
  deleteRunner: (id: string) => void;
  deleteRunners: (ids: Set<string>) => void;
  getRunner: (id: string) => ISavedRunner | undefined;
  duplicateRunner: (id: string) => void;
};

// Generate a simple UUID-like ID
const generateId = () => {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
};

export const useRunnerLibraryStore = create<IRunnerLibraryStore>()(
  persist(
    (set, get) => ({
      runners: [],

      addRunner: (runner) => {
        const id = generateId();
        const now = Date.now();
        const newRunner: ISavedRunner = {
          ...runner,
          id,
          createdAt: now,
          updatedAt: now
        };

        set((state) => ({
          runners: [...state.runners, newRunner]
        }));

        toast.success(`Runner "${runner.notes}" added to library`);
        return id;
      },

      updateRunner: (id, updates) => {
        set((state) => ({
          runners: state.runners.map((runner) =>
            runner.id === id ? { ...runner, ...updates, updatedAt: Date.now() } : runner
          )
        }));

        toast.success('Runner updated');
      },

      deleteRunner: (id) => {
        const runner = get().getRunner(id);

        set((state) => ({
          runners: state.runners.filter((r) => r.id !== id)
        }));

        toast.success(`Runner "${runner?.notes || 'Unknown'}" deleted`);
      },

      deleteRunners: (ids) => {
        const count = ids.size;
        if (count === 0) return;

        set((state) => ({
          runners: state.runners.filter((r) => !ids.has(r.id))
        }));

        toast.success(`Deleted ${count} runner${count === 1 ? '' : 's'}`);
      },

      getRunner: (id) => {
        return get().runners.find((r) => r.id === id);
      },

      duplicateRunner: (id) => {
        const runner = get().getRunner(id);
        if (!runner) {
          toast.error('Runner not found');
          return;
        }

        const duplicated = cloneDeep(runner);

        get().addRunner(duplicated);
      }
    }),
    {
      name: 'umalator-runner-library',
      storage: createJSONStorage(() => localStorage)
    }
  )
);
