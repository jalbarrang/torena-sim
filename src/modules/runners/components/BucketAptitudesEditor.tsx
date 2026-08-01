import { AptitudeSelect } from '@/modules/runners/components/AptitudeSelect';
import {
  DISTANCE_BUCKETS,
  STYLE_BUCKETS,
  SURFACE_BUCKETS,
  type AptitudeBucketKey
} from '@/modules/runners/aptitude-buckets';
import type { RunnerAptitudes } from '@/modules/runners/components/runner-card/domain/runner-state';

type BucketAptitudesEditorProps = {
  value: RunnerAptitudes;
  onChange: (key: AptitudeBucketKey, grade: string) => void;
};

// One shared 5-column template (label + 4 buckets) so every row aligns.
const ROW_GRID = 'grid grid-cols-[4rem_repeat(4,minmax(0,1fr))] items-center gap-2 px-2 py-1.5';

function BucketRow({
  label,
  buckets,
  value,
  onChange
}: {
  label: string;
  buckets: ReadonlyArray<{ key: AptitudeBucketKey; label: string }>;
  value: RunnerAptitudes;
  onChange: (key: AptitudeBucketKey, grade: string) => void;
}) {
  return (
    <div className={ROW_GRID}>
      <span className="text-right text-xs font-medium text-muted-foreground">{label}</span>
      {buckets.map((bucket) => (
        <div key={bucket.key} className="flex items-center justify-between pl-2 pr-0.5 py-0">
          <span className="text-xs text-muted-foreground">{bucket.label}</span>
          <AptitudeSelect
            value={value[bucket.key]}
            onChange={(grade) => onChange(bucket.key, grade)}
            size="sm"
            iconClassName="size-3"
            className="h-6 w-auto gap-0.5 px-0.5 py-0 bg-transparent hover:bg-transparent dark:bg-transparent dark:hover:bg-transparent [&_svg]:size-3"
          />
        </div>
      ))}
    </div>
  );
}

export function BucketAptitudesEditor({ value, onChange }: BucketAptitudesEditorProps) {
  return (
    <div className="flex flex-col overflow-hidden rounded-md [&>div:nth-child(odd)]:bg-muted/40 [&>div:nth-child(even)]:bg-muted/15">
      <BucketRow label="Track" buckets={SURFACE_BUCKETS} value={value} onChange={onChange} />
      <BucketRow label="Distance" buckets={DISTANCE_BUCKETS} value={value} onChange={onChange} />
      <BucketRow label="Style" buckets={STYLE_BUCKETS} value={value} onChange={onChange} />
    </div>
  );
}
