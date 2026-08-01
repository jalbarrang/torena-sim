import { createRunnerState } from '../components/runner-card/domain/runner-state';
import { singleExportToRunnerState } from '../share/converters';
import { ISingleExportData } from '../share/types';
import { getUmaDisplayInfo, getUmaImageUrl } from '../utils';
import type { IAptitudeFilters, IAptitudeSlotKey, IDecodedRunner } from './types';

export function buildDecodedRunner(data: ISingleExportData): IDecodedRunner {
  const partial = singleExportToRunnerState(data);
  const state = createRunnerState(partial);

  const displayInfo = state.outfitId ? getUmaDisplayInfo(state.outfitId) : null;
  const imageUrl = getUmaImageUrl(state.outfitId, state.randomMobId);

  let searchText = 'unknown character';

  if (displayInfo) {
    searchText = `${displayInfo.name} ${displayInfo.outfit}`.toLowerCase();
  } else if (state.outfitId) {
    searchText = `character ${state.outfitId}`.toLowerCase();
  }

  return { source: data, state, displayInfo, imageUrl, searchText };
}

export function passesAptitudeFilters(
  source: ISingleExportData,
  filters: IAptitudeFilters
): boolean {
  for (const key in filters) {
    const minGrade = filters[key as IAptitudeSlotKey];

    if (minGrade != null && source[key as IAptitudeSlotKey] < minGrade) {
      return false;
    }
  }

  return true;
}

export function hasAnyAptitudeFilter(filters: IAptitudeFilters): boolean {
  return Object.values(filters).some((v) => v != null);
}
