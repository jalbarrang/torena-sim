import { Drawer, DrawerContent, DrawerFooter, DrawerTitle } from '@/components/ui/drawer';
import { Popover, PopoverContent } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';
import type { CompareRole } from '@/store/runners.store';
import { FieldManagerContent } from './field-manager-content';

type FieldManagerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` = manage mode; a role = pick mode for that compare slot. */
  pickRole: CompareRole | null;
  /** Anchor element for the desktop popover (the field pill). */
  anchor: React.RefObject<HTMLElement | null>;
};

export function FieldManager(props: FieldManagerProps) {
  const { open, onOpenChange, pickRole, anchor } = props;

  const isMobile = useIsMobile();
  const close = () => onOpenChange(false);

  if (isMobile) {
    return (
      <Drawer direction="bottom" open={open} onOpenChange={onOpenChange}>
        <DrawerContent aria-label="Race field" className="px-3 pb-1">
          <DrawerTitle className="sr-only">Race field</DrawerTitle>
          <div className="min-h-0 overflow-y-auto pt-3">
            <FieldManagerContent pickRole={pickRole} onClose={close} />
          </div>
          <DrawerFooter className="px-0 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
            <Button onClick={close}>Done</Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverContent
        anchor={anchor}
        align="center"
        side="bottom"
        sideOffset={8}
        aria-label="Race field"
        className="flex max-h-[min(560px,calc(100vh-8rem))] w-[400px] flex-col"
      >
        <FieldManagerContent pickRole={pickRole} onClose={close} />
      </PopoverContent>
    </Popover>
  );
}
