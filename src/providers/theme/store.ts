import { createJSONStorage, persist } from 'zustand/middleware';
import { create } from 'zustand';

export type Theme = 'light' | 'dark' | 'system';

export type ThemeState = {
  theme: Theme;
};

export type ThemeStore = ThemeState & {
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
};

const resolveTheme = (theme: Theme): 'light' | 'dark' => {
  if (theme !== 'system') return theme;
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export const applyTheme = (theme: Theme) => {
  if (typeof window === 'undefined') return;

  const root = window.document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(resolveTheme(theme));
};

const defaultThemeState: ThemeState = {
  theme: 'system'
};

const themeCycle: Record<Theme, Theme> = {
  light: 'dark',
  dark: 'system',
  system: 'light'
};

export const createThemeStore = (initState: ThemeState = defaultThemeState) => {
  return create<ThemeStore>()(
    persist(
      (set, get) => {
        return {
          ...initState,
          setTheme: (theme: Theme) => {
            applyTheme(theme);
            set({ theme });
          },
          toggleTheme: () => {
            const { theme, setTheme } = get();
            setTheme(themeCycle[theme]);
          }
        };
      },
      {
        name: 'umalator-theme',
        storage: createJSONStorage(() => localStorage),
        partialize: (state) => ({ theme: state.theme })
      }
    )
  );
};
