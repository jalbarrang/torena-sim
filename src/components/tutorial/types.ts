/**
 * Tutorial system type definitions
 *
 * Custom tutorial library types that replace driver.js.
 * Provides type-safe tutorial step definitions with positioning options.
 */

export type TutorialId =
  | 'umalator'
  | 'skill-bassin'
  | 'uma-bassin'
  | 'carat-calculator'
  | 'team-trials';

type Side = 'top' | 'bottom' | 'left' | 'right';
type Align = 'start' | 'center' | 'end';
type ButtonType = 'previous' | 'next' | 'close';

/**
 * Tutorial step definition
 *
 * Each step can optionally target a DOM element via CSS selector.
 * Steps without an element are rendered as centered dialogs.
 */
export interface TutorialStep {
  /** CSS selector for the element to highlight (optional) */
  element?: string;

  /** Step title displayed in the popover header */
  title: string;

  /** Step description (supports any React node - JSX, components, etc.) */
  description: React.ReactNode;

  /** Which side of the element to position the popover */
  side?: Side;

  /** Horizontal alignment relative to the side */
  align?: Align;

  /** Which navigation buttons to show */
  showButtons?: Array<ButtonType>;

  /** Custom text for the done/finish button (last step) */
  doneBtnText?: string;
}

/**
 * Tutorial configuration
 */
interface TutorialConfig {
  id: TutorialId;
  name: string;
  steps: Array<TutorialStep>;
}

/**
 * Tutorial state for the context provider
 */
export interface TutorialState {
  isActive: boolean;
  currentStepIndex: number;
  steps: Array<TutorialStep>;
  tutorialId: TutorialId | null;
}

/**
 * Tutorial context actions
 */
export interface TutorialActions {
  start: (tutorialId: TutorialId, steps: Array<TutorialStep>) => void;
  next: () => void;
  previous: () => void;
  close: () => void;
  goToStep: (index: number) => void;
}

/**
 * Element bounds for positioning and spotlight
 */
export interface ElementBounds {
  top: number;
  left: number;
  width: number;
  height: number;
  bottom: number;
  right: number;
}
