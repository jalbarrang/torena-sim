import { Button } from '@/components/ui/button';
import { RemovePlannedBannerButton } from '@/modules/carat/components/remove-planned-banner-button';
import { resolveBannerLabel } from '@/modules/carat/data/card-names';
import type { BannerPlanRow } from '@/modules/carat/model/plan';
import { markBannerPulled, reopenBanner } from '@/store/carat.store';
import { cn } from '@/lib/utils';

type BannerLifecycleActionsProps = {
  row: BannerPlanRow;
  className?: string;
  isPrimary?: boolean;
};

export function BannerLifecycleActions(props: BannerLifecycleActionsProps) {
  const { row, className, isPrimary = false } = props;
  const isProvisional = row.status === 'provisional';
  const isRecorded = row.status === 'recorded';
  const bannerLabel = resolveBannerLabel(row.event);

  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {isProvisional ? (
        <Button
          type="button"
          size="xs"
          variant={isPrimary ? 'default' : 'secondary'}
          onClick={() => markBannerPulled(row.event.id, row.ticketsUsed)}
          aria-label={`Mark ${bannerLabel} as pulled`}
        >
          Mark as pulled
        </Button>
      ) : null}
      {isRecorded ? (
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() => reopenBanner(row.event.id)}
          aria-label={`Reopen ${bannerLabel}`}
        >
          Reopen
        </Button>
      ) : null}
      <RemovePlannedBannerButton
        bannerId={row.event.id}
        bannerLabel={bannerLabel}
        label={isProvisional || isRecorded}
      />
    </div>
  );
}
