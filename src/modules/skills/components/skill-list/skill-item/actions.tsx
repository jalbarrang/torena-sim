import { useMemo, useState, type ReactNode } from 'react';
import { CircleHelp, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { ExpandedSkillDetails } from '../../ExpandedSkillDetails';
import { SkillCostDetails } from '../../cost-details';
import { useSkillItem } from './context';
import type { SkillItemCostActionProps, SkillItemDetailsActionsProps } from './types';

type SkillCostDetailsPopoverProps = {
  triggerClassName: string;
  children: ReactNode;
};

function useSkillCostState() {
  const { costSummary, spCost, skillId, getSkillMeta } = useSkillItem();

  const selfMeta = useMemo(() => getSkillMeta(skillId), [getSkillMeta, skillId]);

  const isObtained = useMemo(
    () => costSummary?.isObtained ?? selfMeta.bought ?? false,
    [costSummary?.isObtained, selfMeta.bought]
  );

  const displayedNetCost = useMemo(
    () => costSummary?.netTotal ?? spCost ?? 0,
    [costSummary?.netTotal, spCost]
  );

  const roundedDiscountPct = useMemo(
    () => costSummary?.roundedDiscountPct ?? 0,
    [costSummary?.roundedDiscountPct]
  );

  return { isObtained, displayedNetCost, roundedDiscountPct };
}

function SkillCostDetailsPopover(props: Readonly<SkillCostDetailsPopoverProps>) {
  const { triggerClassName, children } = props;
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="xs"
            className={triggerClassName}
            title="Show skill cost details"
            onClick={(event) => event.stopPropagation()}
          >
            {children}
          </Button>
        }
      />

      {open && (
        <PopoverContent align="start" side="right" className="w-[300px] p-0">
          <SkillCostDetails />
        </PopoverContent>
      )}
    </Popover>
  );
}

export function SkillItemDetailsActions(props: Readonly<SkillItemDetailsActionsProps>) {
  const { dismissable = false, onDismiss } = props;
  const { skill, skillId, distanceFactor, valueScalingContext, onRemove } = useSkillItem();
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <>
      <Popover open={detailsOpen} onOpenChange={setDetailsOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="icon-lg"
              title="Show skill details"
              onClick={(event) => event.stopPropagation()}
            >
              <CircleHelp />
            </Button>
          }
        />

        {detailsOpen && (
          <PopoverContent align="start" side="right" className="w-[300px] p-0">
            <ExpandedSkillDetails
              id={skillId}
              skill={skill}
              distanceFactor={distanceFactor}
              valueScalingContext={valueScalingContext}
            />
          </PopoverContent>
        )}
      </Popover>

      {dismissable && (
        <Button
          variant="ghost"
          size="icon-lg"
          type="button"
          aria-label="Remove skill"
          data-event="remove-skill"
          data-skillid={skillId}
          onClick={(event) => {
            event.stopPropagation();

            if (onDismiss) {
              onDismiss();
              return;
            }

            onRemove?.(skillId);
          }}
        >
          <X />
        </Button>
      )}
    </>
  );
}

export function SkillItemCostAction(props: Readonly<SkillItemCostActionProps>) {
  const { layout = 'inline', className } = props;
  const { hasCost } = useSkillItem();
  const { isObtained, displayedNetCost, roundedDiscountPct } = useSkillCostState();

  if (!hasCost) {
    return null;
  }

  if (layout === 'summary') {
    return (
      <SkillCostDetailsPopover
        triggerClassName={cn(
          'h-8 w-full cursor-pointer justify-end gap-2 rounded-sm border border-border/60 bg-muted/20 px-2 hover:bg-muted/40',
          isObtained
            ? 'border-green-600/30 bg-green-600/5 text-green-600 dark:border-green-400/30 dark:bg-green-400/8 dark:text-green-400'
            : 'text-muted-foreground',
          className
        )}
      >
        {}
        {isObtained && 'Obtained'}

        {!isObtained && (
          <>
            {roundedDiscountPct > 0 && (
              <span className="text-[11px] font-medium italic tracking-tight text-muted-foreground">
                {roundedDiscountPct}% off
              </span>
            )}

            <span className="font-semibold text-foreground">{displayedNetCost} SP</span>
          </>
        )}
      </SkillCostDetailsPopover>
    );
  }

  return (
    <SkillCostDetailsPopover
      triggerClassName={cn(
        'whitespace-nowrap',
        { 'text-green-600 dark:text-green-400': isObtained },
        className
      )}
    >
      {isObtained ? 'Obtained' : `${displayedNetCost} SP`}
    </SkillCostDetailsPopover>
  );
}
