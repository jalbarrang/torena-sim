import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { UmadumpImportDialog, type UmadumpInitialImport } from './import-dialog';
import { decodeUmadumpDeepLinkValue, UMADUMP_IMPORT_PARAM } from './deep-link';

export function UmadumpDeepLinkImport() {
  const location = useLocation();
  const navigate = useNavigate();
  const consumedLocationRef = useRef<string | null>(null);
  const [initialImport, setInitialImport] = useState<UmadumpInitialImport | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (!params.has(UMADUMP_IMPORT_PARAM)) return;

    const locationIdentity = `${location.pathname}${location.search}${location.hash}`;
    if (consumedLocationRef.current === locationIdentity) return;

    if (location.pathname !== '/runners') {
      navigate(
        { pathname: '/runners', search: location.search, hash: location.hash },
        { replace: true }
      );
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;

      consumedLocationRef.current = locationIdentity;
      const value = params.get(UMADUMP_IMPORT_PARAM) ?? '';
      setInitialImport({
        id: value,
        sourceName: 'umadump import link',
        result: decodeUmadumpDeepLinkValue(value)
      });

      params.delete(UMADUMP_IMPORT_PARAM);
      const search = params.toString();
      navigate(
        { pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash },
        { replace: true }
      );
    });

    return () => {
      cancelled = true;
    };
  }, [location.hash, location.pathname, location.search, navigate]);

  if (!initialImport) return null;

  return (
    <UmadumpImportDialog
      key={initialImport.id}
      open
      initialImport={initialImport}
      onOpenChange={(open) => {
        if (!open) setInitialImport(null);
      }}
    />
  );
}
