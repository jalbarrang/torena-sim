import workerPath from 'tesseract.js/dist/worker.min.js?url';
import coreLstmPath from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url';
import coreRelaxedSimdLstmPath from 'tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js?url';
import coreSimdLstmPath from 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url';
import englishDataPath from '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz?url';

const RELAXED_SIMD_TEST = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 15, 1, 13, 0, 65, 1, 253, 15,
  65, 2, 253, 15, 253, 128, 2, 11
]);
const SIMD_TEST = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15,
  253, 98, 11
]);

export type LocalTesseractAssets = {
  workerPath: string;
  corePath: string;
  langPath: string;
  releaseWorkerPath: () => void;
};

export function selectLocalTesseractCorePath(
  validate = (bytes: Uint8Array) => WebAssembly.validate(bytes.buffer as ArrayBuffer)
): string {
  if (validate(RELAXED_SIMD_TEST)) return coreRelaxedSimdLstmPath;
  if (validate(SIMD_TEST)) return coreSimdLstmPath;
  return coreLstmPath;
}

/**
 * The upstream worker builds the traineddata URL from a directory and fixed filename,
 * while Vite fingerprints emitted assets. This tiny local bootstrap preserves that API:
 * it redirects only the English data request to Vite's same-origin asset, then loads the
 * pinned Tesseract worker. Screenshot pixels and recognized text never enter fetch.
 */
export function createTesseractWorkerBootstrap(
  localWorkerPath: string,
  localEnglishDataPath: string
): string {
  return `
const nativeFetch = self.fetch.bind(self);
self.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.endsWith('/eng.traineddata.gz')) {
    return nativeFetch(${JSON.stringify(localEnglishDataPath)}, init);
  }
  return nativeFetch(input, init);
};
importScripts(${JSON.stringify(localWorkerPath)});
`;
}

export async function loadLocalTesseractAssets(signal: AbortSignal): Promise<LocalTesseractAssets> {
  if (signal.aborted) throw new DOMException('OCR asset loading was cancelled.', 'AbortError');

  const bootstrap = createTesseractWorkerBootstrap(workerPath, englishDataPath);
  const localWorkerPath = URL.createObjectURL(new Blob([bootstrap], { type: 'text/javascript' }));

  return {
    workerPath: localWorkerPath,
    corePath: selectLocalTesseractCorePath(),
    // This URL is intercepted by the local bootstrap before any request is sent.
    langPath: `${import.meta.env.BASE_URL}assets/tesseract-language`,
    releaseWorkerPath: () => URL.revokeObjectURL(localWorkerPath)
  };
}
