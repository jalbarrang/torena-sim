import { createContext, use, useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/shallow';
import { config } from '@/config';
import type { OcrEngine } from '@/modules/runners/ocr/engine';
import { WorkerGeminiEngine } from '@/modules/runners/ocr/engines/gemini';
import {
  createOcrDialogStore,
  type IOcrDialogStore,
  type IOcrDialogStoreApi
} from '@/modules/runners/components/ocr/ocr-dialog.store';
import {
  createTurnstileBroker,
  type TurnstileBroker
} from '@/modules/runners/components/ocr/turnstile-broker';

const OcrDialogStoreContext = createContext<IOcrDialogStoreApi | null>(null);
const OcrTurnstileBrokerContext = createContext<TurnstileBroker | null>(null);

type OcrDialogProviderProps = {
  children: React.ReactNode;
};

export function OcrDialogProvider(props: Readonly<OcrDialogProviderProps>) {
  const { children } = props;

  const engineRef = useRef<OcrEngine | null>(null);
  const [broker] = useState(() => createTurnstileBroker());
  const [store] = useState(() => {
    return createOcrDialogStore(engineRef);
  });

  useEffect(() => {
    return () => {
      const { actions } = store.getState();
      actions.cleanup();
    };
  }, [store]);

  useEffect(() => {
    const workerUrl = config.ocr.workerUrl;
    if (!workerUrl) {
      return;
    }

    const engine = new WorkerGeminiEngine(workerUrl, broker.consume);
    engineRef.current = engine;

    return () => {
      if (engineRef.current === engine) {
        engineRef.current = null;
      }

      void engine.destroy();
    };
  }, [broker]);

  return (
    <OcrDialogStoreContext.Provider value={store}>
      <OcrTurnstileBrokerContext.Provider value={broker}>
        {children}
      </OcrTurnstileBrokerContext.Provider>
    </OcrDialogStoreContext.Provider>
  );
}

export function useOcrTurnstileBroker(): TurnstileBroker {
  const broker = use(OcrTurnstileBrokerContext);

  if (!broker) {
    throw new Error('useOcrTurnstileBroker must be used within OcrDialogProvider');
  }

  return broker;
}

function useOcrDialogStore<T>(selector: (state: IOcrDialogStore) => T): T {
  const store = use(OcrDialogStoreContext);

  if (!store) {
    throw new Error('useOcrDialogStore must be used within OcrDialogProvider');
  }

  return useStore(store, selector);
}

export const useOcrResults = () => {
  return useOcrDialogStore((state) => state.results);
};

export const useOcrProcessing = () => {
  return useOcrDialogStore(
    useShallow((state) => ({
      isProcessing: state.isProcessing,
      progress: state.progress,
      error: state.error
    }))
  );
};

export const useOcrActions = () => {
  return useOcrDialogStore(useShallow((state) => state.actions));
};

export const useOcrWizardState = () => {
  return useOcrDialogStore(
    useShallow((state) => ({
      step: state.step,
      preparedImages: state.preparedImages,
      showSkillsEditor: state.showSkillsEditor
    }))
  );
};
