import { useNavigate } from 'react-router';

import { Activity, useReducer, useMemo, useCallback } from 'react';
import { Import, Plus, Search, Trash2, Users, X } from 'lucide-react';
import type { ISavedRunner } from '@/store/runner-library.store';
import { Button } from '@/components/ui/button';
import { FloatingButton } from '@/components/ui/fab';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { useRunnerLibraryStore } from '@/store/runner-library.store';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { getCompareFieldId, loadRunnerFromLibrary, showRunner } from '@/store/runners.store';
import { UmadumpImportDialog } from '@/modules/runners/umadump/import-dialog';
import { getUmaDisplayInfo } from '@/modules/runners/utils';
import { aptitudeNames, strategyNames } from '@/lib/uma-domain/runner/definitions';
import { useIsMobile } from '@/hooks/use-mobile';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import {
  meetsMinGrade,
  VirtualRunnerGrid
} from '@/modules/runners/components/runner-grid/runner-grid';

type IFilterSelectProps = {
  label: string;
  value: string;
  onValueChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
};

function FilterSelect(props: Readonly<IFilterSelectProps>) {
  const { label, value, onValueChange, options } = props;

  return (
    <Select value={value} onValueChange={(v) => onValueChange(v ?? 'all')}>
      <SelectTrigger size="sm" className="w-auto min-w-24 gap-1">
        <SelectValue>
          {value === 'all' ? label : (options.find((o) => o.value === value)?.label ?? label)}
        </SelectValue>
      </SelectTrigger>

      <SelectContent>
        <SelectItem value="all">{label}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// --- Main ---

const STRATEGY_OPTIONS = strategyNames.map((n) => ({ value: n, label: n }));

const APTITUDE_OPTIONS = aptitudeNames.map((g) => ({
  value: g,
  label: g
}));

type RosterHomeState = {
  deleteDialogOpen: boolean;
  runnerToDelete: string | null;
  loadDialogOpen: boolean;
  runnerToLoad: ISavedRunner | null;
  umadumpImportOpen: boolean;
  search: string;
  strategyFilter: string;
  distanceFilter: string;
  surfaceFilter: string;
  selected: Set<string>;
  bulkDeleteDialogOpen: boolean;
};

type RosterHomeAction =
  | { type: 'delete:open'; runnerId: string }
  | { type: 'delete:dialogOpenChange'; open: boolean }
  | { type: 'delete:confirmed'; runnerId: string | null }
  | { type: 'load:open'; runner: ISavedRunner }
  | { type: 'load:dialogOpenChange'; open: boolean }
  | { type: 'load:completed' }
  | { type: 'umadumpImport:openChange'; open: boolean }
  | { type: 'search:set'; value: string }
  | { type: 'filter:strategy'; value: string }
  | { type: 'filter:distance'; value: string }
  | { type: 'filter:surface'; value: string }
  | { type: 'filters:clear' }
  | { type: 'selection:toggle'; id: string }
  | { type: 'selection:selectMany'; ids: string[] }
  | { type: 'selection:deselectMany'; ids: string[] }
  | { type: 'selection:clear' }
  | { type: 'bulkDelete:open' }
  | { type: 'bulkDelete:dialogOpenChange'; open: boolean }
  | { type: 'bulkDelete:confirmed' };

function createInitialRosterHomeState(): RosterHomeState {
  return {
    deleteDialogOpen: false,
    runnerToDelete: null,
    loadDialogOpen: false,
    runnerToLoad: null,
    umadumpImportOpen: false,
    search: '',
    strategyFilter: 'all',
    distanceFilter: 'all',
    surfaceFilter: 'all',
    selected: new Set(),
    bulkDeleteDialogOpen: false
  };
}

function rosterHomeReducer(state: RosterHomeState, action: RosterHomeAction): RosterHomeState {
  switch (action.type) {
    case 'delete:open':
      return { ...state, runnerToDelete: action.runnerId, deleteDialogOpen: true };
    case 'delete:dialogOpenChange':
      return {
        ...state,
        deleteDialogOpen: action.open,
        runnerToDelete: action.open ? state.runnerToDelete : null
      };
    case 'delete:confirmed': {
      const nextSelected = new Set(state.selected);
      if (action.runnerId) nextSelected.delete(action.runnerId);
      return {
        ...state,
        deleteDialogOpen: false,
        runnerToDelete: null,
        selected: nextSelected
      };
    }
    case 'load:open':
      return { ...state, runnerToLoad: action.runner, loadDialogOpen: true };
    case 'load:dialogOpenChange':
      return {
        ...state,
        loadDialogOpen: action.open,
        runnerToLoad: action.open ? state.runnerToLoad : null
      };
    case 'load:completed':
      return { ...state, loadDialogOpen: false, runnerToLoad: null };
    case 'umadumpImport:openChange':
      return { ...state, umadumpImportOpen: action.open };
    case 'search:set':
      return { ...state, search: action.value };
    case 'filter:strategy':
      return { ...state, strategyFilter: action.value };
    case 'filter:distance':
      return { ...state, distanceFilter: action.value };
    case 'filter:surface':
      return { ...state, surfaceFilter: action.value };
    case 'filters:clear':
      return {
        ...state,
        search: '',
        strategyFilter: 'all',
        distanceFilter: 'all',
        surfaceFilter: 'all'
      };
    case 'selection:toggle': {
      const next = new Set(state.selected);
      if (next.has(action.id)) next.delete(action.id);
      else next.add(action.id);
      return { ...state, selected: next };
    }
    case 'selection:selectMany': {
      const next = new Set(state.selected);
      for (const id of action.ids) next.add(id);
      return { ...state, selected: next };
    }
    case 'selection:deselectMany': {
      const next = new Set(state.selected);
      for (const id of action.ids) next.delete(id);
      return { ...state, selected: next };
    }
    case 'selection:clear':
      return { ...state, selected: new Set() };
    case 'bulkDelete:open':
      return { ...state, bulkDeleteDialogOpen: true };
    case 'bulkDelete:dialogOpenChange':
      return { ...state, bulkDeleteDialogOpen: action.open };
    case 'bulkDelete:confirmed':
      return { ...state, bulkDeleteDialogOpen: false, selected: new Set() };
    default:
      return state;
  }
}

export default function RosterHomePage() {
  const navigate = useNavigate();
  const { runners, deleteRunner, deleteRunners, duplicateRunner } = useRunnerLibraryStore();

  const [page, dispatch] = useReducer(rosterHomeReducer, undefined, createInitialRosterHomeState);

  const isSelecting = page.selected.size > 0;

  const isMobile = useIsMobile();

  const searchIndex = useMemo(() => {
    return new Map(
      runners.map((r) => {
        const info = r.outfitId ? getUmaDisplayInfo(r.outfitId) : null;
        const text = [info?.name, info?.outfit, r.notes, r.outfitId]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return [r.id, text];
      })
    );
  }, [runners]);

  const filtered = useMemo(() => {
    const query = page.search.toLowerCase().trim();

    return runners.filter((r) => {
      if (query) {
        const text = searchIndex.get(r.id) ?? '';

        if (!text.includes(query)) {
          return false;
        }
      }

      if (page.strategyFilter !== 'all' && r.strategy !== page.strategyFilter) {
        return false;
      }

      if (
        page.distanceFilter !== 'all' &&
        !meetsMinGrade(r.distanceAptitude, page.distanceFilter)
      ) {
        return false;
      }

      if (page.surfaceFilter !== 'all' && !meetsMinGrade(r.surfaceAptitude, page.surfaceFilter)) {
        return false;
      }

      return true;
    });
  }, [
    runners,
    page.search,
    page.strategyFilter,
    page.distanceFilter,
    page.surfaceFilter,
    searchIndex
  ]);

  const hasActiveFilters = useMemo(
    () =>
      !!page.search.trim() ||
      page.strategyFilter !== 'all' ||
      page.distanceFilter !== 'all' ||
      page.surfaceFilter !== 'all',
    [page.search, page.strategyFilter, page.distanceFilter, page.surfaceFilter]
  );

  const filteredIds = useMemo(() => new Set(filtered.map((r) => r.id)), [filtered]);
  const filteredSelectedCount = useMemo(
    () => [...page.selected].filter((id) => filteredIds.has(id)).length,
    [page.selected, filteredIds]
  );

  const allFilteredSelected = useMemo(
    () => filtered.length > 0 && filteredSelectedCount === filtered.length,
    [filtered, filteredSelectedCount]
  );

  const handleAddNew = () => navigate('/runners/new');

  const handleEdit = useCallback(
    (runner: ISavedRunner) => navigate(`/runners/${runner.id}/edit`),
    [navigate]
  );

  const handleDeleteClick = useCallback((id: string) => {
    dispatch({ type: 'delete:open', runnerId: id });
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    if (page.runnerToDelete) {
      deleteRunner(page.runnerToDelete);
      dispatch({ type: 'delete:confirmed', runnerId: page.runnerToDelete });
    } else {
      dispatch({ type: 'delete:dialogOpenChange', open: false });
    }
  }, [deleteRunner, page.runnerToDelete]);

  const handleLoadClick = useCallback((runner: ISavedRunner) => {
    dispatch({ type: 'load:open', runner });
  }, []);

  const handleLoadToSlot = useCallback(
    (slot: 'uma1' | 'uma2') => {
      if (!page.runnerToLoad) return;

      const fieldId = getCompareFieldId(slot);
      loadRunnerFromLibrary(fieldId, page.runnerToLoad);
      showRunner(fieldId);
      dispatch({ type: 'load:completed' });
      navigate('/');
    },
    [navigate, page.runnerToLoad]
  );

  const toggleSelect = useCallback((id: string) => {
    dispatch({ type: 'selection:toggle', id });
  }, []);

  const selectAllFiltered = useCallback(() => {
    dispatch({ type: 'selection:selectMany', ids: filtered.map((r) => r.id) });
  }, [filtered]);

  const deselectAllFiltered = useCallback(() => {
    dispatch({ type: 'selection:deselectMany', ids: filtered.map((r) => r.id) });
  }, [filtered]);

  const clearSelection = useCallback(() => dispatch({ type: 'selection:clear' }), []);

  const handleBulkDeleteConfirm = useCallback(() => {
    deleteRunners(page.selected);
    dispatch({ type: 'bulkDelete:confirmed' });
  }, [page.selected, deleteRunners]);

  const clearAllFilters = useCallback(() => dispatch({ type: 'filters:clear' }), []);

  return (
    <div className="flex flex-col flex-1 p-4 gap-2 min-h-0 overflow-hidden">
      <div className="flex md:flex-row-reverse md:items-center md:justify-between">
        {/* [Desktop] Actions */}
        {!isMobile && (
          <div className="flex items-center gap-2">
            <Button
              size="default"
              variant="outline"
              onClick={() => dispatch({ type: 'umadumpImport:openChange', open: true })}
            >
              <Import />
              Import
            </Button>

            <Activity mode={runners.length > 0 ? 'visible' : 'hidden'}>
              <Button size="default" onClick={handleAddNew}>
                <Plus />
                Add Runner
              </Button>
            </Activity>
          </div>
        )}

        <div className="flex w-full md:w-fit flex-col md:flex-row md:items-center gap-2">
          <InputGroup className="max-w-sm">
            <InputGroupInput
              placeholder="Search runners..."
              value={page.search}
              onChange={(e) => dispatch({ type: 'search:set', value: e.target.value })}
            />
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
          </InputGroup>

          <div className="flex gap-2">
            <FilterSelect
              label="Strategy"
              value={page.strategyFilter}
              onValueChange={(value) => dispatch({ type: 'filter:strategy', value })}
              options={STRATEGY_OPTIONS}
            />

            <FilterSelect
              label="Distance"
              value={page.distanceFilter}
              onValueChange={(value) => dispatch({ type: 'filter:distance', value })}
              options={APTITUDE_OPTIONS}
            />

            <FilterSelect
              label="Surface"
              value={page.surfaceFilter}
              onValueChange={(value) => dispatch({ type: 'filter:surface', value })}
              options={APTITUDE_OPTIONS}
            />
          </div>

          {hasActiveFilters && (
            <Button variant="ghost" size="icon-sm" onClick={clearAllFilters}>
              <X />
            </Button>
          )}
        </div>
      </div>

      {/* [Mobile] Actions -> FAB */}
      {isMobile && (
        <div className="fixed bottom-6 right-6 z-20">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <FloatingButton aria-label="Runner actions">
                  <Plus />
                </FloatingButton>
              }
            />
            <DropdownMenuContent side="top" align="end" sideOffset={8}>
              <DropdownMenuItem onClick={handleAddNew}>
                <Plus className="size-4" />
                Add Runner
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => dispatch({ type: 'umadumpImport:openChange', open: true })}
              >
                <Import className="size-4" />
                Import
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* [Desktop] Search & Filters */}
      {runners.length > 0 && (
        <div className="flex flex-col gap-2">
          {/* Selection toolbar */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                if (allFilteredSelected) {
                  deselectAllFiltered();
                } else {
                  selectAllFiltered();
                }
              }}
            >
              {allFilteredSelected
                ? `Deselect all ${filtered.length}`
                : `Select all ${runners.length}`}
            </Button>

            <Button
              variant="destructive"
              size="sm"
              onClick={() => dispatch({ type: 'bulkDelete:open' })}
              disabled={page.selected.size === 0}
            >
              <Trash2 />
              Delete ({page.selected.size})
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={clearSelection}
              disabled={page.selected.size === 0}
            >
              Cancel
            </Button>

            {isSelecting && (
              <span className="text-xs text-muted-foreground"> {page.selected.size} selected</span>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      {runners.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Users />
            </EmptyMedia>
            <EmptyTitle>No runners saved</EmptyTitle>
            <EmptyDescription>Register your first runner to get started</EmptyDescription>
          </EmptyHeader>

          <EmptyContent>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => dispatch({ type: 'umadumpImport:openChange', open: true })}
              >
                <Import />
                Import
              </Button>
              <Button onClick={handleAddNew}>
                <Plus className="mr-2" />
                Add Runner
              </Button>
            </div>
          </EmptyContent>
        </Empty>
      )}

      {runners.length > 0 && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
          <span className="text-sm">No runners match the current filters</span>
          <Button variant="ghost" size="sm" onClick={clearAllFilters}>
            Clear filters
          </Button>
        </div>
      )}

      {filtered.length > 0 && (
        <VirtualRunnerGrid
          items={filtered}
          selected={page.selected}
          isSelecting={isSelecting}
          onToggleSelect={toggleSelect}
          onEdit={handleEdit}
          onDelete={handleDeleteClick}
          onDuplicate={duplicateRunner}
          onLoadToSimulation={handleLoadClick}
        />
      )}

      {/* Delete Confirmation Dialog (single) */}
      <Dialog
        open={page.deleteDialogOpen}
        onOpenChange={(open) => dispatch({ type: 'delete:dialogOpenChange', open })}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Runner</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this runner? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => dispatch({ type: 'delete:dialogOpenChange', open: false })}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteConfirm}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Confirmation Dialog */}
      <Dialog
        open={page.bulkDeleteDialogOpen}
        onOpenChange={(open) => dispatch({ type: 'bulkDelete:dialogOpenChange', open })}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {page.selected.size} Runners</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {page.selected.size} runner
              {page.selected.size === 1 ? '' : 's'}? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => dispatch({ type: 'bulkDelete:dialogOpenChange', open: false })}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleBulkDeleteConfirm}>
              Delete {page.selected.size} Runner{page.selected.size === 1 ? '' : 's'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Load to Simulation Dialog */}
      <Dialog
        open={page.loadDialogOpen}
        onOpenChange={(open) => dispatch({ type: 'load:dialogOpenChange', open })}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Load Runner to Compare pages</DialogTitle>
            <DialogDescription>
              Choose which compare slot to load this runner into.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" className="h-25" onClick={() => handleLoadToSlot('uma1')}>
              <div className="text-center">
                <div className="text-lg font-semibold text-[#2a77c5]">Compare A</div>
              </div>
            </Button>
            <Button variant="outline" className="h-25" onClick={() => handleLoadToSlot('uma2')}>
              <div className="text-center">
                <div className="text-lg font-semibold text-[#c52a2a]">Compare B</div>
              </div>
            </Button>
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <UmadumpImportDialog
        open={page.umadumpImportOpen}
        onOpenChange={(open) => dispatch({ type: 'umadumpImport:openChange', open })}
      />
    </div>
  );
}
