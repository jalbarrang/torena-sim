import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

type ObservabilityConsent = 'granted' | 'denied';

type ObservabilityConsentStore = {
  consent: ObservabilityConsent | null;
};

const STORE_NAME = 'torena-analytics-consent';

export const useObservabilityConsentStore = create<ObservabilityConsentStore>()(
  persist((): ObservabilityConsentStore => ({ consent: null }), {
    name: STORE_NAME,
    storage: createJSONStorage(() => localStorage)
  })
);

export const setObservabilityConsent = (consent: ObservabilityConsent) => {
  useObservabilityConsentStore.setState({ consent });
};
