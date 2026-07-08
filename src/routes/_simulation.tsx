import { Suspense, useCallback, useMemo } from 'react';
import { Outlet } from 'react-router';
import { SidebarOpen } from 'lucide-react';

import { LeftSidebar } from '@/layout/left-sidebar';
import { SimulationModeToggle } from '@/components/simulation-mode-toggle';
import { useSkillModalStore } from '@/modules/skills/store';
import { getSelectableSkillsForUma } from '@/modules/skills/utils';
import { Button } from '@/components/ui/button';
import { setLeftSidebar, useLeftSidebar } from '@/store/ui.store';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SkillPickerModal } from '@/modules/skills/components/skill-picker/modal';

export function SimulationLayout() {
  const { hidden } = useLeftSidebar();
  const { open, umaId, currentSkills, onSelect } = useSkillModalStore();

  const options = useMemo(() => {
    return getSelectableSkillsForUma(umaId, true);
  }, [umaId]);

  const handleOpenChange = (value: boolean) => {
    useSkillModalStore.setState({ open: value });
  };

  const handleOpenSidebar = useCallback(() => {
    setLeftSidebar({ hidden: false });
  }, []);

  const handleSelectSkills = (skills: Array<string>) => {
    onSelect(skills);
    handleOpenChange(false);
  };

  return (
    <>
      <SkillPickerModal
        open={open}
        umaId={umaId}
        options={options}
        currentSkills={currentSkills}
        onSelect={handleSelectSkills}
        onOpenChange={handleOpenChange}
      />

      <LeftSidebar />

      <div className="flex flex-col flex-1 min-w-0 overflow-auto p-4 gap-4">
        <div className="flex align-center gap-2">
          {hidden && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button variant="default" size="lg" onClick={handleOpenSidebar} className="w-16">
                    <SidebarOpen />
                  </Button>
                }
              />
              <TooltipContent>Open Sidebar</TooltipContent>
            </Tooltip>
          )}

          <SimulationModeToggle />
        </div>

        <div className="flex flex-1 min-w-0">
          <Suspense
            fallback={
              <div className="flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
                Loading route…
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </div>
      </div>
    </>
  );
}
