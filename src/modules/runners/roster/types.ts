import { IRunnerState } from '../components/runner-card/domain/runner-state';
import { ISingleExportData } from '../share/types';

export type IDecodedRunner = {
  source: ISingleExportData;
  state: IRunnerState;
  displayInfo: { name: string; outfit: string } | null;
  imageUrl: string;
  searchText: string;
  importNotes?: string;
};

export type IAptitudeSlotKey =
  | 'proper_distance_short'
  | 'proper_distance_mile'
  | 'proper_distance_middle'
  | 'proper_distance_long'
  | 'proper_ground_turf'
  | 'proper_ground_dirt'
  | 'proper_running_style_nige'
  | 'proper_running_style_senko'
  | 'proper_running_style_sashi'
  | 'proper_running_style_oikomi';

export type IAptitudeFilterRow = {
  label: string;
  slots: Array<{ key: IAptitudeSlotKey; name: string }>;
};

export type IAptitudeFilters = Partial<Record<IAptitudeSlotKey, number>>;
