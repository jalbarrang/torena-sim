import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { recordObservabilityRoute } from './observability';

export function ObservabilityRouteTracker() {
  const location = useLocation();

  useEffect(() => {
    recordObservabilityRoute(location.pathname);
  }, [location.pathname]);

  return null;
}
