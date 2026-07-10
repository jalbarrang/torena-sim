import { lazy } from 'react';

/** Lazy chart modules — import from here so recharts stays out of the main bundle. */
export const LazyActivationEffectChart = lazy(() =>
  import('./activation-effect-chart').then((module) => ({
    default: module.ActivationEffectChart
  }))
);

export const LazyLengthDifferenceChart = lazy(() =>
  import('./length-difference-chart').then((module) => ({
    default: module.LengthDifferenceChart
  }))
);

export const LazyVelocityComparisonChart = lazy(() =>
  import('./velocity-comparison-chart').then((module) => ({
    default: module.VelocityComparisonChart
  }))
);

/** Reserved for upcoming activation frequency UI — use this export when wiring the feature. */
const LazyActivationFrequencyChart = lazy(() =>
  import('./activation-frequency-chart').then((module) => ({
    default: module.ActivationFrequencyChart
  }))
);
