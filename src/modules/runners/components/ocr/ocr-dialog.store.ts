import type { RefObject } from 'react';
import { createStore } from 'zustand/vanilla';
import type {
  OcrMaskType,
  PreparedImage,
  WizardStep
} from '@/modules/runners/components/ocr/types';
import { parseOcrResult } from '@/modules/runners/ocr/parser';
import type { OcrEngine } from '@/modules/runners/ocr/engine';
import type { ExtractedSkill, ExtractedUmaData } from '@/modules/runners/ocr/types';

type OcrDialogState = {
  isProcessing: boolean;
  progress: number;
  error: string | null;
  results: Partial<ExtractedUmaData> | null;
  step: WizardStep;
  preparedImages: Array<PreparedImage>;
  showSkillsEditor: boolean;

  _engineRef: RefObject<OcrEngine | null>;
  _pendingMaskType: OcrMaskType | null;
  _pendingBaseData: Partial<ExtractedUmaData> | null;
};

type OcrDialogActions = {
  processComposited: (
    blob: Blob,
    maskType: OcrMaskType,
    existingData?: Partial<ExtractedUmaData>
  ) => Promise<Partial<ExtractedUmaData> | null>;
  updateResults: (updates: Partial<ExtractedUmaData>) => void;
  removeSkill: (skillId: string) => void;
  reset: () => void;
  setStep: (step: WizardStep) => void;
  setShowSkillsEditor: (show: boolean) => void;
  addPreparedImage: (image: PreparedImage) => void;
  clearPreparedImages: () => void;
  cleanup: () => void;
};

export type IOcrDialogStore = OcrDialogState & {
  actions: OcrDialogActions;
};

const INITIAL_STEP: WizardStep = 'align';

function dedupeSkills(skills: Array<ExtractedSkill>): Array<ExtractedSkill> {
  const byId = new Map<string, ExtractedSkill>();
  for (const skill of skills) {
    if (!byId.has(skill.id)) byId.set(skill.id, skill);
  }
  return [...byId.values()];
}

function dedupeStrings(lines: Array<string>): Array<string> {
  return [...new Set(lines)];
}

function mergeExtractedResults(
  baseData: Partial<ExtractedUmaData> | null,
  nextData: Partial<ExtractedUmaData> | null,
  maskType: OcrMaskType
): Partial<ExtractedUmaData> | null {
  if (!nextData) return baseData;
  if (!baseData) return nextData;

  const mergedSkills = dedupeSkills([...(baseData.skills ?? []), ...(nextData.skills ?? [])]);
  const mergedUnrecognized = dedupeStrings([
    ...(baseData.unrecognized ?? []),
    ...(nextData.unrecognized ?? [])
  ]);

  if (maskType === 'skills-only') {
    return {
      ...nextData,
      ...baseData,
      skills: mergedSkills,
      unrecognized: mergedUnrecognized,
      imageCount: (baseData.imageCount ?? 0) + (nextData.imageCount ?? 1),
      umaConfidence: baseData.umaConfidence ?? nextData.umaConfidence ?? 0
    };
  }

  return {
    ...baseData,
    ...nextData,
    skills: mergedSkills,
    unrecognized: mergedUnrecognized,
    imageCount: Math.max(baseData.imageCount ?? 0, nextData.imageCount ?? 0),
    umaConfidence: nextData.umaConfidence ?? baseData.umaConfidence ?? 0
  };
}

function revokePreparedPreviews(images: Array<PreparedImage>) {
  for (const image of images) URL.revokeObjectURL(image.preview);
}

export function createOcrDialogStore(engineRef: RefObject<OcrEngine | null>) {
  return createStore<IOcrDialogStore>()((set, get) => {
    const resetState = () => {
      revokePreparedPreviews(get().preparedImages);
      set({
        isProcessing: false,
        progress: 0,
        error: null,
        results: null,
        step: INITIAL_STEP,
        preparedImages: [],
        showSkillsEditor: false
      });
    };

    return {
      isProcessing: false,
      progress: 0,
      error: null,
      results: null,
      step: INITIAL_STEP,
      preparedImages: [],
      showSkillsEditor: false,

      _engineRef: engineRef,
      _pendingBaseData: null,
      _pendingMaskType: null,

      actions: {
        processComposited: async (blob, maskType, existingData) => {
          const state = get();

          if (state.isProcessing) return state.results;

          const engine = state._engineRef.current;
          if (!engine) {
            const msg = 'Screenshot import is not available (OCR service not configured).';
            set({ error: msg });
            throw new Error(msg);
          }

          const baseData = existingData ?? state.results;

          set({
            isProcessing: true,
            progress: 0,
            error: null
          });

          try {
            set({ progress: 10 });
            const engineResult = await engine.recognize(blob);
            set({ progress: 90 });

            const parsed = parseOcrResult(engineResult, 0);
            const merged = mergeExtractedResults(baseData, parsed, maskType);

            set({ results: merged, isProcessing: false, progress: 100 });

            return merged;
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'OCR processing failed';

            set({ isProcessing: false, error: msg });

            return null;
          }
        },

        updateResults: (updates) => {
          set((state) => ({
            results: state.results ? { ...state.results, ...updates } : updates
          }));
        },

        removeSkill: (skillId) => {
          const { results } = get();
          if (!results?.skills) return;

          set({ results: { ...results, skills: results.skills.filter((s) => s.id !== skillId) } });
        },

        reset: resetState,

        setStep: (step) => set({ step }),

        setShowSkillsEditor: (showSkillsEditor) => set({ showSkillsEditor }),

        addPreparedImage: (image) =>
          set((state) => ({ preparedImages: [...state.preparedImages, image] })),

        clearPreparedImages: () => {
          revokePreparedPreviews(get().preparedImages);
          set({ preparedImages: [] });
        },

        cleanup: resetState
      }
    };
  });
}

export type IOcrDialogStoreApi = ReturnType<typeof createOcrDialogStore>;
