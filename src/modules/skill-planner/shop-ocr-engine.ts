import {
  assertShopScreenshotDimensions,
  createPreprocessedShopCrop,
  decodeShopScreenshot,
  getShopRowCrops,
  releaseShopOcrCrop,
  type ImageDimensions,
  type PixelRectangle
} from './shop-ocr-preprocessing';
import { loadLocalTesseractAssets, type LocalTesseractAssets } from './tesseract-assets';
import {
  matchRecognizedShopRows,
  type RecognizedShopRow,
  type ShopOcrEngine,
  type ShopOcrProgress,
  type ShopOcrResult
} from './shop-ocr';

type TesseractLog = {
  status?: string;
  progress?: number;
};

type TesseractWorker = {
  setParameters: (parameters: Record<string, string>) => Promise<unknown>;
  recognize: (
    image: unknown,
    options?: { rectangle?: PixelRectangle }
  ) => Promise<{ data: { text: string; confidence: number } }>;
  terminate: () => Promise<unknown>;
};

type TesseractWorkerOptions = {
  logger: (message: TesseractLog) => void;
  errorHandler: (error: unknown) => void;
  workerPath: string;
  corePath: string;
  langPath: string;
  workerBlobURL: boolean;
};

type TesseractModule = {
  createWorker: (
    langs: string,
    oem: number,
    options: TesseractWorkerOptions
  ) => Promise<TesseractWorker>;
};

type DecodedShopImage = ImageDimensions & {
  close: () => void;
};

type LocalShopOcrEngineOptions = {
  loadTesseract?: () => Promise<TesseractModule>;
  decodeImage?: (image: Blob | File) => Promise<DecodedShopImage>;
  createCrop?: (image: DecodedShopImage, rectangle: PixelRectangle) => unknown;
  releaseCrop?: (crop: unknown) => void;
  matchRows?: (rows: Array<RecognizedShopRow>) => ShopOcrResult;
  initializationTimeoutMs?: number;
  recognitionTimeoutMs?: number;
  loadAssets?: (signal: AbortSignal) => Promise<LocalTesseractAssets>;
};

type ActiveOperation = {
  id: number;
  jobIndex: number;
  lastRecognitionProgress: number;
  listener?: (progress: ShopOcrProgress) => void;
};

type EngineGeneration = {
  id: number;
  controller: AbortController;
  queue: Promise<void>;
  worker: TesseractWorker | null;
  workerPromise: Promise<TesseractWorker> | null;
  terminationPromise: Promise<void> | null;
  releaseWorkerPath: (() => void) | null;
  activeOperation: ActiveOperation | null;
};

const OCR_JOB_COUNT = 6;
const DEFAULT_INITIALIZATION_TIMEOUT_MS = 120_000;
const DEFAULT_RECOGNITION_TIMEOUT_MS = 45_000;
class OcrTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OcrTimeoutError';
  }
}

async function loadTesseract(): Promise<TesseractModule> {
  // Deliberately deferred: Tesseract's API layer stays out of the initial route chunk.
  const module = await import('tesseract.js');
  return module as unknown as TesseractModule;
}

function clampProgress(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function makeAbortError(): DOMException {
  return new DOMException('Shop screenshot processing was cancelled.', 'AbortError');
}

function raceWithCancellation<T>(
  promise: Promise<T>,
  signals: Array<AbortSignal>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      for (const signal of signals) signal.removeEventListener('abort', handleAbort);
      callback();
    };
    const handleAbort = () => finish(() => reject(makeAbortError()));
    const timeoutId = setTimeout(
      () => finish(() => reject(new OcrTimeoutError(timeoutMessage))),
      timeoutMs
    );

    for (const signal of signals) {
      if (signal.aborted) {
        handleAbort();
        return;
      }
      signal.addEventListener('abort', handleAbort, { once: true });
    }

    void promise.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error))
    );
  });
}

/**
 * Reusable, single-worker shop OCR. Files, rows, and crops are intentionally processed
 * one at a time so only one decoded screenshot and one upscaled crop are live at once.
 * Every worker generation has its own queue and cancellation signal, so terminating an
 * in-flight Tesseract job cannot strand a later import behind an unresolved promise.
 */
export class LocalShopOcrEngine implements ShopOcrEngine {
  private readonly loadTesseract: () => Promise<TesseractModule>;
  private readonly decodeImage: (image: Blob | File) => Promise<DecodedShopImage>;
  private readonly createCrop: (image: DecodedShopImage, rectangle: PixelRectangle) => unknown;
  private readonly releaseCrop: (crop: unknown) => void;
  private readonly matchRows: (rows: Array<RecognizedShopRow>) => ShopOcrResult;
  private readonly initializationTimeoutMs: number;
  private readonly recognitionTimeoutMs: number;
  private readonly loadAssets: (signal: AbortSignal) => Promise<LocalTesseractAssets>;
  private readonly terminatedWorkers = new WeakSet<TesseractWorker>();

  private nextGenerationId = 0;
  private nextOperationId = 0;
  private generation: EngineGeneration;

  constructor(options: LocalShopOcrEngineOptions = {}) {
    this.loadTesseract = options.loadTesseract ?? loadTesseract;
    this.decodeImage = options.decodeImage ?? decodeShopScreenshot;
    this.createCrop =
      options.createCrop ??
      ((image, rectangle) =>
        createPreprocessedShopCrop(image as unknown as CanvasImageSource, rectangle));
    this.releaseCrop =
      options.releaseCrop ?? ((crop) => releaseShopOcrCrop(crop as HTMLCanvasElement));
    this.matchRows = options.matchRows ?? matchRecognizedShopRows;
    this.initializationTimeoutMs =
      options.initializationTimeoutMs ?? DEFAULT_INITIALIZATION_TIMEOUT_MS;
    this.recognitionTimeoutMs = options.recognitionTimeoutMs ?? DEFAULT_RECOGNITION_TIMEOUT_MS;
    this.loadAssets = options.loadAssets ?? loadLocalTesseractAssets;
    this.generation = this.createGeneration();
  }

  private createGeneration(): EngineGeneration {
    return {
      id: ++this.nextGenerationId,
      controller: new AbortController(),
      queue: Promise.resolve(),
      worker: null,
      workerPromise: null,
      terminationPromise: null,
      releaseWorkerPath: null,
      activeOperation: null
    };
  }

  private report(
    generation: EngineGeneration,
    operationId: number,
    phase: ShopOcrProgress['phase'],
    label: string,
    progress: number
  ): void {
    if (this.generation !== generation) return;
    const active = generation.activeOperation;
    if (!active || active.id !== operationId) return;

    const boundedProgress = clampProgress(progress);
    const monotonicProgress =
      phase === 'recognizing' ? Math.max(active.lastRecognitionProgress, boundedProgress) : 0;
    if (phase === 'recognizing') active.lastRecognitionProgress = monotonicProgress;

    active.listener?.({ phase, label, progress: monotonicProgress });
  }

  private handleTesseractLog(generation: EngineGeneration, message: TesseractLog): void {
    const active = generation.activeOperation;
    if (!active) return;

    if (message.status === 'recognizing text') {
      const jobProgress = clampProgress(message.progress ?? 0);
      this.report(
        generation,
        active.id,
        'recognizing',
        `Reading shop row ${Math.floor(active.jobIndex / 2) + 1} of 3 on device…`,
        (active.jobIndex + jobProgress) / OCR_JOB_COUNT
      );
      return;
    }

    const label =
      message.status === 'loading language traineddata'
        ? 'Loading English OCR data from Torena Sim…'
        : message.status === 'loading tesseract core'
          ? 'Loading the local OCR runtime…'
          : 'Initializing on-device OCR…';
    this.report(generation, active.id, 'loading', label, 0);
  }

  private assertActive(signal: AbortSignal, generation: EngineGeneration): void {
    if (signal.aborted || generation.controller.signal.aborted) throw makeAbortError();
  }

  private async terminateWorker(worker: TesseractWorker): Promise<void> {
    if (this.terminatedWorkers.has(worker)) return;
    this.terminatedWorkers.add(worker);
    await worker.terminate().catch(() => undefined);
  }

  private terminateGeneration(generation: EngineGeneration): Promise<void> {
    if (generation.terminationPromise) return generation.terminationPromise;

    const worker = generation.worker;
    if (worker) {
      generation.terminationPromise = this.terminateWorker(worker);
      return generation.terminationPromise;
    }

    // Worker creation cannot itself be cancelled. If it resolves after this generation
    // was abandoned, terminate that late worker without making destroy() wait forever.
    if (generation.workerPromise) {
      void generation.workerPromise
        .then((lateWorker) => this.terminateWorker(lateWorker))
        .catch(() => undefined);
    }
    generation.terminationPromise = Promise.resolve();
    return generation.terminationPromise;
  }

  private releaseGenerationWorkerPath(generation: EngineGeneration): void {
    const release = generation.releaseWorkerPath;
    generation.releaseWorkerPath = null;
    release?.();
  }

  private invalidateGeneration(generation: EngineGeneration): Promise<void> {
    generation.activeOperation = null;
    generation.controller.abort();
    this.releaseGenerationWorkerPath(generation);
    if (this.generation === generation) this.generation = this.createGeneration();
    return this.terminateGeneration(generation);
  }

  private getWorkerPromise(
    generation: EngineGeneration,
    operationId: number
  ): Promise<TesseractWorker> {
    if (!generation.workerPromise) {
      this.report(
        generation,
        operationId,
        'loading',
        'Loading on-device OCR assets from Torena Sim…',
        0
      );
      generation.workerPromise = (async () => {
        const assets = await this.loadAssets(generation.controller.signal);
        generation.releaseWorkerPath = assets.releaseWorkerPath;
        try {
          if (generation.controller.signal.aborted) throw makeAbortError();
          const { createWorker } = await this.loadTesseract();
          if (generation.controller.signal.aborted) throw makeAbortError();

          const worker = await createWorker('eng', 1, {
            workerPath: assets.workerPath,
            corePath: assets.corePath,
            langPath: assets.langPath,
            workerBlobURL: false,
            logger: (message) => this.handleTesseractLog(generation, message),
            errorHandler: () => undefined
          });
          generation.worker = worker;

          if (generation.controller.signal.aborted) {
            await this.terminateWorker(worker);
            throw makeAbortError();
          }

          try {
            await worker.setParameters({
              preserve_interword_spaces: '1',
              user_defined_dpi: '300'
            });
          } catch (error) {
            await this.terminateWorker(worker);
            throw error;
          }

          if (generation.controller.signal.aborted) {
            await this.terminateWorker(worker);
            throw makeAbortError();
          }
          return worker;
        } finally {
          this.releaseGenerationWorkerPath(generation);
        }
      })();
    }

    return generation.workerPromise;
  }

  private async awaitInitialization<T>(
    promise: Promise<T>,
    signal: AbortSignal,
    generation: EngineGeneration
  ): Promise<T> {
    return raceWithCancellation(
      promise,
      [signal, generation.controller.signal],
      this.initializationTimeoutMs,
      'On-device OCR took too long to initialize. Please try again.'
    );
  }

  private async awaitRecognition<T>(
    promise: Promise<T>,
    signal: AbortSignal,
    generation: EngineGeneration
  ): Promise<T> {
    return raceWithCancellation(
      promise,
      [signal, generation.controller.signal],
      this.recognitionTimeoutMs,
      'Reading this screenshot took too long. Try a smaller image.'
    );
  }

  private async recognizeNow(
    generation: EngineGeneration,
    imageData: Blob | File,
    signal: AbortSignal,
    onProgress?: (progress: ShopOcrProgress) => void
  ): Promise<ShopOcrResult> {
    const operationId = ++this.nextOperationId;
    generation.activeOperation = {
      id: operationId,
      jobIndex: 0,
      lastRecognitionProgress: 0,
      listener: onProgress
    };

    let image: DecodedShopImage | null = null;
    try {
      this.assertActive(signal, generation);
      image = await this.awaitRecognition(this.decodeImage(imageData), signal, generation);
      this.assertActive(signal, generation);
      assertShopScreenshotDimensions(image);

      const worker = await this.awaitInitialization(
        this.getWorkerPromise(generation, operationId),
        signal,
        generation
      );
      this.assertActive(signal, generation);
      this.report(generation, operationId, 'recognizing', 'Reading shop rows on device…', 0);

      const rows: Array<RecognizedShopRow> = [];
      for (const row of getShopRowCrops(image)) {
        this.assertActive(signal, generation);
        const active = generation.activeOperation;
        if (active) active.jobIndex = row.rowIndex * 2;
        await this.awaitRecognition(
          worker.setParameters({ tessedit_pageseg_mode: '7' }),
          signal,
          generation
        );
        const nameCrop = this.createCrop(image, row.name);
        let nameResult: Awaited<ReturnType<TesseractWorker['recognize']>>;
        try {
          nameResult = await this.awaitRecognition(worker.recognize(nameCrop), signal, generation);
        } finally {
          this.releaseCrop(nameCrop);
        }

        this.assertActive(signal, generation);
        if (active) active.jobIndex += 1;
        await this.awaitRecognition(
          worker.setParameters({ tessedit_pageseg_mode: '6' }),
          signal,
          generation
        );
        const hintCrop = this.createCrop(image, row.hint);
        let hintResult: Awaited<ReturnType<TesseractWorker['recognize']>>;
        try {
          hintResult = await this.awaitRecognition(worker.recognize(hintCrop), signal, generation);
        } finally {
          this.releaseCrop(hintCrop);
        }

        rows.push({
          nameText: nameResult.data.text,
          hintText: hintResult.data.text,
          confidence: nameResult.data.confidence
        });
        this.report(
          generation,
          operationId,
          'recognizing',
          `Read shop row ${row.rowIndex + 1} of 3 on device.`,
          (row.rowIndex * 2 + 2) / OCR_JOB_COUNT
        );
      }

      this.assertActive(signal, generation);
      return this.matchRows(rows);
    } catch (error) {
      const userCancelled = signal.aborted;
      const generationCancelled = generation.controller.signal.aborted;
      if (userCancelled || error instanceof OcrTimeoutError || generation.workerPromise) {
        void this.invalidateGeneration(generation);
      }
      if (userCancelled || (generationCancelled && !(error instanceof OcrTimeoutError))) {
        throw makeAbortError();
      }
      throw error;
    } finally {
      image?.close();
      if (generation.activeOperation?.id === operationId) {
        generation.activeOperation = null;
      }
    }
  }

  recognize(
    imageData: Blob | File,
    signal: AbortSignal,
    onProgress?: (progress: ShopOcrProgress) => void
  ): Promise<ShopOcrResult> {
    const generation = this.generation;
    const operation = this.awaitInitialization(generation.queue, signal, generation).then(() =>
      this.recognizeNow(generation, imageData, signal, onProgress)
    );
    generation.queue = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  async destroy(): Promise<void> {
    await this.invalidateGeneration(this.generation);
  }
}
