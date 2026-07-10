import { useMemo } from 'react';

/**
 * Feature Flag Keys
 * Add new feature flags here to maintain type safety across the application
 */
export const FeatureFlags: Record<string, string> = {};

export type FeatureFlagKey = keyof typeof FeatureFlags;

/**
 * Check if a feature flag is enabled
 * This function can be used in any context (React components, workers, utilities)
 *
 * @param flag - The feature flag key to check
 * @returns true if the feature is enabled, false otherwise
 *
 * @example
 * ```ts
 * if (isFeatureEnabled('NEW_DASHBOARD')) {
 *   // Use new dashboard
 * }
 * ```
 */
export function isFeatureEnabled(flag: FeatureFlagKey): boolean {
  const envKey = FeatureFlags[flag];
  const value = (import.meta.env ?? process.env)[envKey];

  // Environment variables are strings, check for "true"
  return value === 'true';
}

/**
 * React hook to check if a feature flag is enabled
 * Use this in React components for reactive feature flag checks
 *
 * @param flag - The feature flag key to check
 * @returns true if the feature is enabled, false otherwise
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const showNewUI = useFeature('NEW_DASHBOARD');
 *   return showNewUI ? <NewDashboard /> : <OldDashboard />;
 * }
 * ```
 */
export function useFeature(flag: FeatureFlagKey): boolean {
  return useMemo(() => isFeatureEnabled(flag), [flag]);
}

/**
 * React component for conditional rendering based on feature flags
 *
 * @example
 * ```tsx
 * <FeatureFlag feature="EXPERIMENTAL_CHARTS">
 *   <AdvancedCharts />
 * </FeatureFlag>
 * ```
 */
export function FeatureFlag({
  feature,
  children,
  fallback = null
}: {
  feature: FeatureFlagKey;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const isEnabled = useFeature(feature);
  return isEnabled ? children : fallback;
}

/**
 * Get all feature flags and their current states
 * Useful for debugging and development
 *
 * @returns Object mapping feature flag keys to their enabled state
 *
 * @example
 * ```ts
 * const flags = getAllFeatureFlags();
 * console.log('Active flags:', flags);
 * // { NEW_DASHBOARD: false, OPTIMIZED_ALGORITHM: true, ... }
 * ```
 */
export function getAllFeatureFlags(): Record<FeatureFlagKey, boolean> {
  const flags = Object.keys(FeatureFlags);

  return flags.reduce(
    (acc, flag) => {
      acc[flag] = isFeatureEnabled(flag);
      return acc;
    },
    {} as Record<FeatureFlagKey, boolean>
  );
}
