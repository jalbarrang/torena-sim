import { cn } from '@/lib/utils';

type PlanEmptyStateProps = { className?: string };

/** Shown in place of the plan when nothing is planned yet. Shared by the table and card branches. */
export function PlanEmptyState(props: PlanEmptyStateProps) {
  const { className } = props;

  return (
    <div className={cn('p-8 text-center', className)}>
      <div className="text-sm font-semibold">Start with three quick steps</div>
      <ol className="mx-auto mt-3 w-fit space-y-1 text-left text-sm text-muted-foreground">
        <li>
          1. Set your available carats and tickets in{' '}
          <span className="font-medium text-foreground">Plan assumptions → Balance</span>
        </li>
        <li>
          2. Add a banner with{' '}
          <span className="font-medium text-foreground">+ Add banner from timeline</span>
        </li>
        <li>3. Set pulls and review the projection</li>
      </ol>
    </div>
  );
}
