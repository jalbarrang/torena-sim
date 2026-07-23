import type { ReactNode } from 'react';
import { PostHogErrorBoundary, PostHogProvider } from '@posthog/react';
import { posthogClient } from './posthog-adapter';

type ObservabilityBoundaryProps = {
  children: ReactNode;
};

export function ObservabilityBoundary(props: ObservabilityBoundaryProps) {
  const { children } = props;

  return (
    <PostHogProvider client={posthogClient}>
      <PostHogErrorBoundary
        additionalProperties={() => ({
          error_boundary: 'root',
          app_route: window.location.pathname
        })}
      >
        {children}
      </PostHogErrorBoundary>
    </PostHogProvider>
  );
}
