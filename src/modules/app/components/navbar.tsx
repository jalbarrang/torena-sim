import { Link, NavLink, useLocation } from 'react-router';
import { useCallback, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { Drawer, DrawerContent, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { ChevronDown, MenuIcon } from 'lucide-react';

import { useIsMobile } from '@/hooks/use-mobile';

type NavItem = {
  value: string;
  label: string;
  to: string;
};

const mainNavItems: NavItem[] = [
  { value: 'simulation', label: 'Compare', to: '/' },
  { value: 'skill-planner', label: 'Skill Planner', to: '/skill-planner' },
  { value: 'race-sim', label: 'Race Sim', to: '/race-sim' },
  { value: 'runners', label: 'Veterans', to: '/runners' }
];

const toolNavItems: NavItem[] = [
  { value: 'skills', label: 'Skills', to: '/skills' },
  { value: 'skill-visualizer', label: 'Skill Visualizer', to: '/skill-visualizer' },
  { value: 'support-cards', label: 'Support Cards', to: '/support-cards' },
  { value: 'carat-calculator', label: 'Carat Calculator', to: '/carat-calculator' },
  { value: 'trainee-list', label: 'Trainee List', to: '/trainee-list' }
];

export function Navbar() {
  const { pathname } = useLocation();

  const isMobile = useIsMobile();

  const currentTab = useMemo(() => {
    if (pathname.startsWith('/runners')) return 'runners';
    if (pathname === '/skill-planner') return 'skill-planner';
    if (pathname === '/skills') return 'skills';
    if (pathname === '/skill-visualizer') return 'skill-visualizer';
    if (pathname === '/support-cards') return 'support-cards';
    if (pathname === '/carat-calculator') return 'carat-calculator';
    if (pathname === '/trainee-list') return 'trainee-list';
    if (pathname.startsWith('/race-sim')) return 'race-sim';
    return 'simulation';
  }, [pathname]);

  return (
    <header className="flex py-2 justify-between items-center border-b px-4 shrink-0">
      {isMobile ? (
        <MobileNavbar currentTab={currentTab} />
      ) : (
        <DesktopNavbar currentTab={currentTab} />
      )}

      <div className="flex items-center gap-2">
        <ThemeToggle />
      </div>
    </header>
  );
}

type MobileNavbarProps = {
  currentTab: string;
};

const MobileNavbar = (props: MobileNavbarProps) => {
  const { currentTab } = props;

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleNavClick = useCallback(() => {
    setMobileMenuOpen(false);
  }, []);

  const renderNavLink = (item: NavItem) => (
    <NavLink
      key={item.value}
      to={item.to}
      draggable={false}
      onClick={handleNavClick}
      className={cn('rounded-md px-3 py-2 text-sm font-medium text-left transition-colors', {
        'bg-accent text-accent-foreground': currentTab === item.value,
        'text-muted-foreground hover:bg-accent/50 hover:text-foreground': currentTab !== item.value
      })}
    >
      {item.label}
    </NavLink>
  );

  return (
    <Drawer open={mobileMenuOpen} onOpenChange={setMobileMenuOpen} direction="top">
      <DrawerTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Open navigation menu">
          <MenuIcon />
        </Button>
      </DrawerTrigger>

      <DrawerContent aria-describedby="">
        <DrawerTitle className="sr-only">Navigation</DrawerTitle>
        <nav className="flex flex-col p-2 gap-1">
          {mainNavItems.map(renderNavLink)}

          <span className="px-3 pt-2 pb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Tools
          </span>

          {toolNavItems.map(renderNavLink)}
        </nav>
      </DrawerContent>
    </Drawer>
  );
};

type DesktopNavbarProps = {
  currentTab: string;
};

const DesktopNavbar = (props: DesktopNavbarProps) => {
  const { currentTab } = props;

  const isToolActive = toolNavItems.some((item) => item.value === currentTab);

  return (
    <nav className="flex items-center gap-1">
      {mainNavItems.map((item) => (
        <NavLink
          key={item.value}
          to={item.to}
          draggable={false}
          className={cn('rounded-md px-3 py-1.5 text-sm font-medium transition-colors', {
            'bg-accent text-accent-foreground': item.value === currentTab,
            'text-muted-foreground hover:bg-accent/50 hover:text-foreground':
              item.value !== currentTab
          })}
        >
          {item.label}
        </NavLink>
      ))}

      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            'flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            {
              'bg-accent text-accent-foreground': isToolActive,
              'text-muted-foreground hover:bg-accent/50 hover:text-foreground': !isToolActive
            }
          )}
        >
          Tools
          <ChevronDown className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-auto min-w-44">
          {toolNavItems.map((item) => (
            <DropdownMenuItem
              key={item.value}
              className={cn('cursor-pointer', {
                'bg-accent text-accent-foreground': item.value === currentTab
              })}
              render={<Link to={item.to} draggable={false} />}
            >
              {item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
};
