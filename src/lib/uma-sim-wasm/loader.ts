// Async loader for the wasm-pack (`--target web`) module. Initializes the WASM
// instance once per worker/realm and exposes the typed batch + streaming APIs.
//
// The generated bundle lives at `./pkg/uma_sim_wasm.js` after `bun run
// wasm:build`. We import it through a *variable* specifier so the typechecker
// does not require the generated artifact to be present, while Vite still
// resolves it at build time.

import type {
  RunnerTickSnapshot,
  WasmCompareData,
  WasmCompareParams,
  WasmContestedCompareParams,
  WasmRaceSimParams,
  WasmRaceSimResult
} from './types';

/** The shape of the wasm-pack-generated module we depend on. */
type UmaSimWasmModule = {
  // wasm-bindgen's `init`: pass a single options object. `module_or_path`
  // accepts a precompiled `WebAssembly.Module`; omit it to fetch+compile the
  // colocated `.wasm`.
  default: (options?: { module_or_path?: WebAssembly.Module }) => Promise<unknown>;
  runRaceSim: (params: WasmRaceSimParams) => WasmRaceSimResult;
  runCompare: (params: WasmCompareParams) => WasmCompareData;
  runContestedCompare: (params: WasmContestedCompareParams) => WasmCompareData;
  WasmRaceSimulator: new (params: WasmRaceSimParams) => WasmRaceSimulatorHandle;
};

type WasmRaceSimulatorHandle = {
  setOnRoundStart: (cb: (seed: number) => void) => void;
  setOnBeforeTick: (cb: (dt: number) => void) => void;
  setOnAfterRunnerTick: (cb: (snapshot: RunnerTickSnapshot) => void) => void;
  setOnRunnerFinished: (cb: (runnerId: number) => void) => void;
  setOnRoundEnd: (cb: () => void) => void;
  run: () => WasmRaceSimResult;
};

const PKG_SPECIFIER = './pkg/uma_sim_wasm.js';
// Resolved at runtime against the loader's chunk URL (which lives in `assets/`,
// next to the copied `pkg/`). Used to compile the module ONCE on the main
// thread and share the compiled `WebAssembly.Module` with pool workers (each
// worker then only instantiates, skipping a redundant fetch+compile). A
// non-literal first arg keeps Vite from rewriting it — `pkg/` is managed by the
// `copy-uma-sim-wasm-pkg` build plugin, not bundled.
const WASM_BG_SPECIFIER = './pkg/uma_sim_wasm_bg.wasm';

let modulePromise: Promise<UmaSimWasmModule> | null = null;
let compiledModulePromise: Promise<WebAssembly.Module> | null = null;

async function loadModule(precompiled?: WebAssembly.Module): Promise<UmaSimWasmModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const mod = (await import(/* @vite-ignore */ PKG_SPECIFIER)) as UmaSimWasmModule;
      // Passing a `WebAssembly.Module` makes wasm-bindgen's init skip the
      // fetch+compile and only instantiate; `undefined` falls back to the
      // default fetch of the colocated `.wasm`. The options-object form avoids
      // wasm-bindgen's positional-arg deprecation warning.
      await mod.default(precompiled ? { module_or_path: precompiled } : undefined);
      return mod;
    })();
  }
  return modulePromise;
}

/** Initialize the WASM module exactly once (idempotent). */
export async function initUmaSimWasm(): Promise<void> {
  await loadModule();
}

/**
 * Initialize from a pre-compiled module (shared across pool workers). Falls back
 * to a self-contained fetch+compile if instantiation from the shared module
 * fails, so a transfer/compat issue degrades to the previous behavior rather
 * than breaking the worker.
 */
export async function initUmaSimWasmFromModule(module: WebAssembly.Module): Promise<void> {
  try {
    await loadModule(module);
  } catch (error) {
    console.warn('Shared WASM module init failed; falling back to self-compile.', error);
    modulePromise = null;
    await loadModule();
  }
}

/**
 * Compile the `WebAssembly.Module` once per realm (memoized). Intended for the
 * main thread to compile a single module and post it to pool workers.
 */
export async function compileUmaSimWasmModule(): Promise<WebAssembly.Module> {
  if (!compiledModulePromise) {
    compiledModulePromise = (async () => {
      const wasmUrl = new URL(WASM_BG_SPECIFIER, import.meta.url).href;
      return WebAssembly.compileStreaming(fetch(wasmUrl));
    })();
  }
  return compiledModulePromise;
}

/** Run a batch simulation. Ensures the module is initialized first. */
export async function runRaceSim(params: WasmRaceSimParams): Promise<WasmRaceSimResult> {
  const mod = await loadModule();
  return mod.runRaceSim(params);
}

/** Run a batch compare-family simulation. Ensures the module is initialized first. */
export async function runCompare(params: WasmCompareParams): Promise<WasmCompareData> {
  const mod = await loadModule();
  return mod.runCompare(params);
}

/** Run a same-race compare-family simulation. Ensures the module is initialized first. */
export async function runContestedCompare(
  params: WasmContestedCompareParams
): Promise<WasmCompareData> {
  const mod = await loadModule();
  return mod.runContestedCompare(params);
}

/** Streaming callbacks for {@link createRaceSimulator}. */
type RaceSimCallbacks = {
  onRoundStart?: (seed: number) => void;
  onBeforeTick?: (dt: number) => void;
  onAfterRunnerTick?: (snapshot: RunnerTickSnapshot) => void;
  onRunnerFinished?: (runnerId: number) => void;
  onRoundEnd?: () => void;
};

/**
 * Build a streaming simulator. Callbacks fire live during the returned `run()`;
 * the serialized batch result is returned when all rounds complete.
 */
async function createRaceSimulator(
  params: WasmRaceSimParams,
  callbacks: RaceSimCallbacks = {}
): Promise<() => WasmRaceSimResult> {
  const mod = await loadModule();
  const sim = new mod.WasmRaceSimulator(params);
  if (callbacks.onRoundStart) sim.setOnRoundStart(callbacks.onRoundStart);
  if (callbacks.onBeforeTick) sim.setOnBeforeTick(callbacks.onBeforeTick);
  if (callbacks.onAfterRunnerTick) sim.setOnAfterRunnerTick(callbacks.onAfterRunnerTick);
  if (callbacks.onRunnerFinished) sim.setOnRunnerFinished(callbacks.onRunnerFinished);
  if (callbacks.onRoundEnd) sim.setOnRoundEnd(callbacks.onRoundEnd);
  return () => sim.run();
}
