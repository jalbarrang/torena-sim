/// <reference types="vite/client" />

declare const __APP__VERSION__: string;

interface ImportMetaEnv {
  // Feature Flags
  readonly VITE_FEATURE_BASSIN_L_PER_SP?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
