import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTesseractWorkerBootstrap,
  loadLocalTesseractAssets,
  selectLocalTesseractCorePath
} from './tesseract-assets';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('local Tesseract asset configuration', () => {
  it('selects a bundled core variant for the browser feature set', () => {
    const relaxed = selectLocalTesseractCorePath(() => true);
    const simd = selectLocalTesseractCorePath(
      vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
    );
    const baseline = selectLocalTesseractCorePath(() => false);

    expect(relaxed).toContain('tesseract-core-relaxedsimd-lstm.wasm');
    expect(simd).toContain('tesseract-core-simd-lstm.wasm');
    expect(baseline).toContain('tesseract-core-lstm.wasm');
  });

  it('builds a local worker bootstrap that redirects only the language asset', () => {
    const bootstrap = createTesseractWorkerBootstrap(
      '/assets/worker.min.js',
      '/assets/eng.traineddata.gz'
    );

    expect(bootstrap).toContain('importScripts("/assets/worker.min.js")');
    expect(bootstrap).toContain('nativeFetch("/assets/eng.traineddata.gz", init)');
    expect(bootstrap).toContain("url.endsWith('/eng.traineddata.gz')");
    expect(bootstrap).not.toContain('jsdelivr');
  });

  it('returns emitted same-origin paths without fetching an OCR asset in the main thread', async () => {
    const createObjectUrl = vi.fn().mockReturnValue('blob:local-tesseract-worker');
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      value: createObjectUrl,
      configurable: true
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: revokeObjectUrl,
      configurable: true
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const assets = await loadLocalTesseractAssets(new AbortController().signal);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(assets.workerPath).toBe('blob:local-tesseract-worker');
    expect(assets.corePath).not.toMatch(/^https?:\/\//u);
    expect(assets.langPath).not.toMatch(/^https?:\/\//u);
    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
    assets.releaseWorkerPath();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:local-tesseract-worker');
  });
});
