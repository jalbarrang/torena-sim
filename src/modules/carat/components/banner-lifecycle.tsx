import { Badge } from '@/components/ui/badge';
import type { BannerPlanRow } from '@/modules/carat/model/plan';

type BannerLifecycleProps = { row: BannerPlanRow; className?: string };

export function BannerLifecycle(props: BannerLifecycleProps) {
  const { row, className } = props;
  const isProvisional = row.status === 'provisional';
  const label = isProvisional ? 'Action needed' : row.status === 'recorded' ? 'Pulled' : 'Planned';
  const variant = isProvisional
    ? 'destructive'
    : row.status === 'recorded'
      ? 'secondary'
      : 'outline';

  return (
    <div className={className}>
      <Badge variant={variant}>{label}</Badge>
      {isProvisional ? (
        <p className="mt-1 text-[11px] leading-snug text-destructive">
          This banner ended. Planned spend is provisional until you record what you pulled.
        </p>
      ) : null}
    </div>
  );
}
