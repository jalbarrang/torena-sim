import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useShallow } from 'zustand/shallow';

type ISidebar = {
  activePanel: string | null;
  hidden: boolean;
};

export type UIDismissalKey = 'race-sim-notice';

type IUIDismissals = Record<UIDismissalKey, boolean>;

export type IUIStore = {
  // UI counter state
  runOnceCounter: number;

  // Dropdown/modal state (ephemeral)
  isPacemakerDropdownOpen: boolean;
  showVirtualPacemakerOnGraph: boolean;
  showCreditsModal: boolean;
  showChangelogModal: boolean;
  showSuggestionModal: boolean;
  dismissals: IUIDismissals;

  leftSide: ISidebar;
};

export const useUIStore = create<IUIStore>()(
  persist(
    (_) => ({
      runOnceCounter: 0,
      isPacemakerDropdownOpen: false,
      showVirtualPacemakerOnGraph: false,
      showCreditsModal: false,
      showChangelogModal: false,
      showSuggestionModal: false,
      dismissals: {
        'race-sim-notice': false
      },
      leftSide: {
        activePanel: 'runners',
        hidden: true
      }
    }),
    {
      name: 'umalator-ui',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        leftSide: state.leftSide,
        dismissals: state.dismissals
      })
    }
  )
);

const setRunOnceCounter = (runOnceCounter: number) => {
  useUIStore.setState({ runOnceCounter });
};

const incrementRunOnceCounter = () => {
  useUIStore.setState((state) => ({
    runOnceCounter: state.runOnceCounter + 1
  }));
};

const setIsPacemakerDropdownOpen = (isPacemakerDropdownOpen: boolean) => {
  useUIStore.setState({ isPacemakerDropdownOpen });
};

const toggleShowVirtualPacemakerOnGraph = () => {
  useUIStore.setState((state) => ({
    showVirtualPacemakerOnGraph: !state.showVirtualPacemakerOnGraph
  }));
};

export const setShowCreditsModal = (showCreditsModal: boolean) => {
  useUIStore.setState({ showCreditsModal });
};

export const setShowChangelogModal = (showChangelogModal: boolean) => {
  useUIStore.setState({ showChangelogModal });
};

export const setShowSuggestionModal = (showSuggestionModal: boolean) => {
  useUIStore.setState({ showSuggestionModal });
};

export const setDismissal = (key: UIDismissalKey, dismissed: boolean) => {
  useUIStore.setState((state) => ({
    dismissals: {
      ...state.dismissals,
      [key]: dismissed
    }
  }));
};

export const setLeftSidebar = (sidebar: Partial<ISidebar>) => {
  useUIStore.setState((state) => ({
    leftSide: {
      ...state.leftSide,
      ...sidebar
    }
  }));
};

export const useLeftSidebar = () => {
  return useUIStore(useShallow((state) => state.leftSide));
};
