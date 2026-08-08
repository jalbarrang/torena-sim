/**
 * Tutorial Context Provider
 *
 * Manages global tutorial state and provides actions for navigation.
 * This replaces the driver.js instance management with React context.
 */

import { createContext, use, useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { TutorialActions, TutorialId, TutorialState, TutorialStep } from './types';

type TutorialContextValue = TutorialState & TutorialActions;

const TutorialContext = createContext<TutorialContextValue | null>(null);

type TutorialProviderProps = {
  children: ReactNode;
};

/**
 * Give a step the chance to reveal its target before the overlay resolves the
 * selector, which happens in an effect on the render that follows.
 */
function runBeforeStep(step: TutorialStep | undefined) {
  step?.onBeforeStep?.();
}

export function TutorialProvider(props: TutorialProviderProps) {
  const { children } = props;
  const [state, setState] = useState<TutorialState>({
    isActive: false,
    currentStepIndex: 0,
    steps: [],
    tutorialId: null
  });
  const stateRef = useRef(state);

  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);

  const start = useCallback((tutorialId: TutorialId, steps: Array<TutorialStep>) => {
    runBeforeStep(steps[0]);
    setState({
      isActive: true,
      currentStepIndex: 0,
      steps,
      tutorialId
    });
  }, []);

  const next = useCallback(() => {
    const { currentStepIndex, steps } = stateRef.current;

    if (currentStepIndex < steps.length - 1) {
      runBeforeStep(steps[currentStepIndex + 1]);
      setState((prev) => ({ ...prev, currentStepIndex: prev.currentStepIndex + 1 }));
      return;
    }

    // On last step, "next" button closes the tutorial
    setState((prev) => ({ ...prev, isActive: false }));
  }, []);

  const previous = useCallback(() => {
    const { currentStepIndex, steps } = stateRef.current;
    if (currentStepIndex <= 0) return;

    runBeforeStep(steps[currentStepIndex - 1]);
    setState((prev) => ({ ...prev, currentStepIndex: prev.currentStepIndex - 1 }));
  }, []);

  const close = useCallback(() => {
    setState((prev) => ({ ...prev, isActive: false }));
  }, []);

  const goToStep = useCallback((index: number) => {
    const { steps } = stateRef.current;
    if (index < 0 || index >= steps.length) return;

    runBeforeStep(steps[index]);
    setState((prev) => ({ ...prev, currentStepIndex: index }));
  }, []);

  const value: TutorialContextValue = {
    ...state,
    start,
    next,
    previous,
    close,
    goToStep
  };

  return <TutorialContext.Provider value={value}>{children}</TutorialContext.Provider>;
}

/**
 * Hook to access tutorial context
 *
 * @throws Error if used outside TutorialProvider
 */
export function useTutorial() {
  const context = use(TutorialContext);
  if (!context) {
    throw new Error('useTutorial must be used within a TutorialProvider');
  }
  return context;
}

/**
 * Hook to get the current tutorial step
 */
export function useCurrentStep() {
  const { steps, currentStepIndex, isActive } = useTutorial();
  if (!isActive || steps.length === 0) {
    return null;
  }
  return steps[currentStepIndex] ?? null;
}

/**
 * Hook to check if tutorial is on first/last step
 */
export function useTutorialProgress() {
  const { currentStepIndex, steps, isActive } = useTutorial();
  return {
    isActive,
    isFirstStep: currentStepIndex === 0,
    isLastStep: currentStepIndex === steps.length - 1,
    currentStep: currentStepIndex + 1,
    totalSteps: steps.length,
    progress: steps.length > 0 ? ((currentStepIndex + 1) / steps.length) * 100 : 0
  };
}
