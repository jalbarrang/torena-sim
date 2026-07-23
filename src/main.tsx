import { config } from './config';

if (config.enableGrab) {
  import('react-grab');
}

import './polyfills';
import { DataBootGate } from '@/components/data-boot-gate';
import { ObservabilityBoundary } from '@/modules/observability/observability-boundary';
import { ObservabilityRouteTracker } from '@/modules/observability/observability-route-tracker';
import { initializeObservability } from '@/modules/observability/observability';

// Supports weights 100-900
import '@fontsource-variable/inter/wght.css';
// Supports weights 100-900
import '@fontsource-variable/noto-sans-jp/wght.css';

import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './i18n';

import { enableMapSet } from 'immer';
import { reconcileStoresAfterHydration } from '@/store/race/reconcile';
import { ThemeStoreProvider } from './providers/theme/provider';
import { RootComponent } from './routes/root';

initializeObservability();

enableMapSet();
reconcileStoresAfterHydration();

const rootComponent = document.getElementById('root');

if (!rootComponent) {
  throw new Error('Root element not found');
}

const root = createRoot(rootComponent);
const queryClient = new QueryClient();

// The app mounts immediately; <DataBootGate> (inside the providers) shows the
// splash while the data bootstrap runs, then renders the routes once the service
// singletons are populated.
root.render(
  <ObservabilityBoundary>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={config.basePath}>
        <ObservabilityRouteTracker />
        <ThemeStoreProvider>
          <DataBootGate>
            <RootComponent />
          </DataBootGate>
        </ThemeStoreProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </ObservabilityBoundary>
);
