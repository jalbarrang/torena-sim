import type { ExtractedUmaData } from '@/modules/runners/ocr/types';
import type { RunnerAptitudes } from '@/modules/runners/components/runner-card/types';
import {
  DISTANCE_BUCKETS,
  STYLE_BUCKETS,
  SURFACE_BUCKETS,
  type AptitudeBucketKey
} from '@/modules/runners/aptitude-buckets';
import { AptitudeSelect } from '@/modules/runners/components/AptitudeSelect';

type OcrAptitudesEditorProps = {
  results: Partial<ExtractedUmaData> | null;
  onUpdateResults: (updates: Partial<ExtractedUmaData>) => void;
};

// Blank slate when OCR produced no aptitudes yet: every bucket defaults to 'G'.
const EMPTY_APTITUDES: RunnerAptitudes = {
  turf: 'G',
  dirt: 'G',
  distanceShort: 'G',
  distanceMile: 'G',
  distanceMiddle: 'G',
  distanceLong: 'G',
  nige: 'G',
  senko: 'G',
  sashi: 'G',
  oikomi: 'G'
};

const GROUPS: ReadonlyArray<{
  title: string;
  buckets: ReadonlyArray<{ key: AptitudeBucketKey; label: string }>;
}> = [
  { title: 'Track', buckets: SURFACE_BUCKETS },
  { title: 'Distance', buckets: DISTANCE_BUCKETS },
  { title: 'Style', buckets: STYLE_BUCKETS }
];

export function OcrAptitudesEditor(props: Readonly<OcrAptitudesEditorProps>) {
  const { results, onUpdateResults } = props;
  const aptitudes = results?.aptitudes ?? EMPTY_APTITUDES;

  const handleChange = (key: AptitudeBucketKey) => (grade: string) => {
    onUpdateResults({ aptitudes: { ...aptitudes, [key]: grade } });
  };

  return (
    <section className="space-y-2">
      <h4 className="text-sm font-medium text-muted-foreground">Aptitudes</h4>

      <div className="divide-y divide-border/60 overflow-hidden rounded-md border">
        {GROUPS.map((group) => (
          <div key={group.title} className="flex items-center gap-3 px-3 py-2">
            <span className="w-16 shrink-0 text-xs font-medium text-muted-foreground">
              {group.title}
            </span>

            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {group.buckets.map((bucket) => (
                <label
                  key={bucket.key}
                  className="flex items-center gap-1.5 text-sm tabular-nums"
                >
                  <span className="w-14 text-xs text-muted-foreground">{bucket.label}</span>
                  <AptitudeSelect
                    value={aptitudes[bucket.key]}
                    onChange={handleChange(bucket.key)}
                    size="sm"
                    className="w-auto rounded-md border bg-background/40 px-1.5"
                    iconClassName="size-5"
                  />
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
