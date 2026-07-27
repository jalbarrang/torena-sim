import { BannerPullResultFields } from '@/modules/carat/components/banner-pull-result-fields';
import { CopiesOddsBar } from '@/modules/carat/components/copies-odds-bar';
import { TargetGoals } from '@/modules/carat/components/target-goals';
import { UmaOddsBar } from '@/modules/carat/components/uma-odds-bar';
import { characterPickupCount, supportPickupCount } from '@/modules/carat/data/card-names';
import type { BannerPlanRow } from '@/modules/carat/model/plan';
import { cn } from '@/lib/utils';

type BannerOutcomeProps = { row: BannerPlanRow; className?: string };

export function BannerOutcome(props: BannerOutcomeProps) {
  const { row, className } = props;

  if (row.status === 'recorded') {
    return <BannerPullResultFields row={row} section="copies" className={className} />;
  }

  return (
    <div data-tutorial="carat-odds" className={cn(className)}>
      {row.event.card_type === 'character' ? (
        <UmaOddsBar pickupCount={characterPickupCount(row.event)} className="min-w-0" />
      ) : (
        <CopiesOddsBar
          pulls={row.plannedBanner.plannedPulls}
          startingDupes={row.plannedBanner.startingDupes}
          pickupCount={supportPickupCount(row.event)}
          className="min-w-0"
        />
      )}
      <TargetGoals row={row} className="mt-2" />
    </div>
  );
}
