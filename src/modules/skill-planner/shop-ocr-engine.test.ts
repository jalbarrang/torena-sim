import { describe, expect, it, vi } from 'vitest';
import { LocalShopOcrEngine } from './shop-ocr-engine';
import type { RecognizedShopRow } from './shop-ocr';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

const releaseWorkerPath = vi.fn();
const LOCAL_ASSETS = {
  workerPath: 'blob:local-worker',
  corePath: '/assets/core.js',
  langPath: '/assets/tesseract-language',
  releaseWorkerPath
};

function successfulRecognizeMock() {
  return vi
    .fn()
    .mockResolvedValueOnce({ data: { text: 'First Skill', confidence: 91 } })
    .mockResolvedValueOnce({ data: { text: 'Hint Lvl 1', confidence: 90 } })
    .mockResolvedValueOnce({ data: { text: 'Second Skill', confidence: 92 } })
    .mockResolvedValueOnce({ data: { text: 'Hint Lvl 2', confidence: 90 } })
    .mockResolvedValueOnce({ data: { text: 'Third Skill', confidence: 93 } })
    .mockResolvedValueOnce({ data: { text: 'Hint Lvl 3', confidence: 90 } });
}

function createHarness() {
  const terminate = vi.fn().mockResolvedValue(undefined);
  const setParameters = vi.fn().mockResolvedValue(undefined);
  const recognize = successfulRecognizeMock();
  const createWorker = vi.fn().mockResolvedValue({ terminate, setParameters, recognize });
  const loadTesseract = vi.fn().mockResolvedValue({ createWorker });
  const loadAssets = vi.fn().mockResolvedValue(LOCAL_ASSETS);
  const close = vi.fn();
  const createCrop = vi.fn(
    (_image: unknown, rectangle: { top: number; left: number }) =>
      `crop-${rectangle.top}-${rectangle.left}`
  );
  const releaseCrop = vi.fn();
  const matchRows = vi.fn((rows: Array<RecognizedShopRow>) => ({
    matches: [],
    unmatchedNames: rows.map((row) => row.nameText)
  }));

  const engine = new LocalShopOcrEngine({
    loadTesseract,
    loadAssets,
    decodeImage: vi.fn().mockResolvedValue({ width: 620, height: 507, close }),
    createCrop,
    releaseCrop,
    matchRows
  });

  return {
    engine,
    close,
    createCrop,
    createWorker,
    loadAssets,
    loadTesseract,
    matchRows,
    recognize,
    releaseCrop,
    setParameters,
    terminate
  };
}

describe('LocalShopOcrEngine', () => {
  it('loads pinned local assets lazily and runs bounded name/hint jobs sequentially', async () => {
    const harness = createHarness();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    expect(harness.loadTesseract).not.toHaveBeenCalled();
    expect(harness.loadAssets).not.toHaveBeenCalled();

    const result = await harness.engine.recognize(
      new Blob(['local image'], { type: 'image/png' }),
      new AbortController().signal
    );

    expect(harness.loadTesseract).toHaveBeenCalledTimes(1);
    expect(harness.loadAssets).toHaveBeenCalledTimes(1);
    expect(harness.createWorker).toHaveBeenCalledWith('eng', 1, {
      workerPath: 'blob:local-worker',
      corePath: '/assets/core.js',
      langPath: '/assets/tesseract-language',
      workerBlobURL: false,
      logger: expect.any(Function),
      errorHandler: expect.any(Function)
    });
    expect(releaseWorkerPath).toHaveBeenCalledOnce();
    expect(harness.setParameters).toHaveBeenNthCalledWith(1, {
      preserve_interword_spaces: '1',
      user_defined_dpi: '300'
    });
    expect(harness.setParameters).toHaveBeenNthCalledWith(2, {
      tessedit_pageseg_mode: '7'
    });
    expect(harness.setParameters).toHaveBeenNthCalledWith(3, {
      tessedit_pageseg_mode: '6'
    });
    expect(harness.setParameters).toHaveBeenCalledTimes(7);
    expect(harness.recognize).toHaveBeenCalledTimes(6);
    expect(harness.createCrop).toHaveBeenCalledTimes(6);
    expect(harness.releaseCrop).toHaveBeenCalledTimes(6);
    expect(harness.close).toHaveBeenCalledTimes(1);
    expect(harness.matchRows).toHaveBeenCalledWith([
      { nameText: 'First Skill', hintText: 'Hint Lvl 1', confidence: 91 },
      { nameText: 'Second Skill', hintText: 'Hint Lvl 2', confidence: 92 },
      { nameText: 'Third Skill', hintText: 'Hint Lvl 3', confidence: 93 }
    ]);
    expect(result.unmatchedNames).toEqual(['First Skill', 'Second Skill', 'Third Skill']);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('checks abort between OCR jobs and releases decoded resources', async () => {
    const harness = createHarness();
    const controller = new AbortController();
    harness.recognize.mockReset().mockImplementationOnce(async () => {
      controller.abort();
      return { data: { text: 'First Skill', confidence: 90 } };
    });

    await expect(
      harness.engine.recognize(new Blob(['local image'], { type: 'image/png' }), controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(harness.recognize).toHaveBeenCalledTimes(1);
    expect(harness.releaseCrop).toHaveBeenCalledTimes(1);
    expect(harness.close).toHaveBeenCalledTimes(1);
    expect(harness.terminate).toHaveBeenCalledTimes(1);
  });

  it('settles destroy during unresolved initialization and permits a fresh import', async () => {
    const firstLoad = deferred<{ createWorker: ReturnType<typeof vi.fn> }>();
    const harness = createHarness();
    harness.loadTesseract
      .mockReset()
      .mockImplementationOnce(() => firstLoad.promise)
      .mockResolvedValue({ createWorker: harness.createWorker });

    const abandoned = harness.engine.recognize(
      new Blob(['first'], { type: 'image/png' }),
      new AbortController().signal
    );
    await vi.waitFor(() => expect(harness.loadTesseract).toHaveBeenCalledOnce());
    await harness.engine.destroy();
    await expect(abandoned).rejects.toMatchObject({ name: 'AbortError' });

    const fresh = await harness.engine.recognize(
      new Blob(['second'], { type: 'image/png' }),
      new AbortController().signal
    );
    expect(fresh.unmatchedNames).toEqual(['First Skill', 'Second Skill', 'Third Skill']);
    expect(harness.loadTesseract).toHaveBeenCalledTimes(2);
  });

  it('settles destroy during unresolved recognition and starts a fresh worker generation', async () => {
    const pendingRecognition = deferred<{
      data: { text: string; confidence: number };
    }>();
    const firstTerminate = vi.fn().mockResolvedValue(undefined);
    const firstWorker = {
      terminate: firstTerminate,
      setParameters: vi.fn().mockResolvedValue(undefined),
      recognize: vi.fn().mockImplementation(() => pendingRecognition.promise)
    };
    const secondRecognize = successfulRecognizeMock();
    const secondTerminate = vi.fn().mockResolvedValue(undefined);
    const secondWorker = {
      terminate: secondTerminate,
      setParameters: vi.fn().mockResolvedValue(undefined),
      recognize: secondRecognize
    };
    const createWorker = vi
      .fn()
      .mockResolvedValueOnce(firstWorker)
      .mockResolvedValueOnce(secondWorker);
    const engine = new LocalShopOcrEngine({
      loadTesseract: vi.fn().mockResolvedValue({ createWorker }),
      loadAssets: vi.fn().mockResolvedValue(LOCAL_ASSETS),
      decodeImage: vi.fn().mockImplementation(async () => ({
        width: 620,
        height: 507,
        close: vi.fn()
      })),
      createCrop: vi.fn().mockReturnValue('crop'),
      releaseCrop: vi.fn(),
      matchRows: (rows) => ({ matches: [], unmatchedNames: rows.map((row) => row.nameText) })
    });

    const abandoned = engine.recognize(
      new Blob(['first'], { type: 'image/png' }),
      new AbortController().signal
    );
    await vi.waitFor(() => expect(firstWorker.recognize).toHaveBeenCalledOnce());
    await engine.destroy();
    await expect(abandoned).rejects.toMatchObject({ name: 'AbortError' });
    expect(firstTerminate).toHaveBeenCalledOnce();

    const fresh = await engine.recognize(
      new Blob(['second'], { type: 'image/png' }),
      new AbortController().signal
    );
    expect(fresh.unmatchedNames).toEqual(['First Skill', 'Second Skill', 'Third Skill']);
    expect(createWorker).toHaveBeenCalledTimes(2);
    expect(secondRecognize).toHaveBeenCalledTimes(6);
  });

  it('reports monotonic recognition progress when Tesseract logger values regress', async () => {
    const harness = createHarness();
    const updates: Array<number> = [];
    let logger: ((message: { status: string; progress: number }) => void) | undefined;
    harness.createWorker.mockImplementation(
      async (
        _langs: unknown,
        _oem: unknown,
        options: { logger: (message: { status: string; progress: number }) => void }
      ) => {
        logger = options.logger;
        return {
          terminate: harness.terminate,
          setParameters: harness.setParameters,
          recognize: harness.recognize
        };
      }
    );
    harness.recognize.mockReset().mockImplementation(async () => {
      logger?.({ status: 'recognizing text', progress: 0.8 });
      logger?.({ status: 'recognizing text', progress: 0.2 });
      return { data: { text: 'Skill', confidence: 90 } };
    });

    await harness.engine.recognize(
      new Blob(['local image'], { type: 'image/png' }),
      new AbortController().signal,
      (progress) => {
        if (progress.phase === 'recognizing') updates.push(progress.progress);
      }
    );

    expect(updates).toEqual([...updates].sort((left, right) => left - right));
  });

  it('terminates its reusable worker exactly once', async () => {
    const harness = createHarness();

    await harness.engine.recognize(
      new Blob(['local image'], { type: 'image/png' }),
      new AbortController().signal
    );
    await harness.engine.destroy();
    await harness.engine.destroy();

    expect(harness.terminate).toHaveBeenCalledTimes(1);
  });
});
