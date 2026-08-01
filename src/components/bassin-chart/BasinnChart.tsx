import { useCallback, useMemo, useRef, useState } from 'react';

import { getCoreRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Row, SortingState } from '@tanstack/react-table';

import { Play } from 'lucide-react';
import { Button } from '../ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../ui/empty';
import './BasinnChart.css';

import type { SkillComparisonRoundResult } from '@/modules/simulation/types';
import type { SkillSummaryMeta } from '@/modules/skills/skill-cost-summary';
import { skillsService } from '@/modules/data/services/SkillService';
import type { SkillEntry } from '@/modules/data/services/SkillService';
import { groups_filters } from '@/modules/skills/filters';
import i18n from '@/i18n';
import { cn } from '@/lib/utils';

import { IconTypeFilterBar, useIconTypeFilter } from './filters/icon-type-filter';
import { BassinTableBody, BASSIN_DATA_EVENT_OPEN_SKILL_ACTIONS } from './table/bassin-table-body';
import { BassinTableHeader } from './table/bassin-table-header';
import { BASSIN_DATA_EVENT_TOGGLE_SKILL_DETAILS } from './table/skill-name-cell';
import { TableSearchBar } from './table/search-bar';
import { useTableSearch } from './table/use-table-search';
import { useBassinColumns } from './table/use-bassin-columns';
import {
  BASSIN_DATA_EVENT_TOGGLE_ACTIVATION_DETAILS,
  SkillActivationDetailsDialog
} from './activation-details/activation-details-dialog';
import { Popover, PopoverContent } from '../ui/popover';
import { ExpandedSkillDetails } from '@/modules/skills/components/ExpandedSkillDetails';
import { Menu as MenuPrimitive } from '@base-ui/react/menu';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from '../ui/dropdown-menu';
import React from 'react';

type BasinnChartProps = {
  data: Array<SkillComparisonRoundResult>;
  hiddenSkills: Array<string>;
  showUmaIcons?: boolean;
  selectedSkills: Array<string>;
  isSimulationRunning: boolean;
  courseDistance?: number;
  currentSeed?: number | null;
  skillLoadingStates?: Record<string, boolean>;
  onAddSkill: (id: string) => void;
  onSelectionChange: (id: string) => void;
  onReplaceOutfit?: (id: string) => void;
  onRunAdditionalSamples?: (skillId: string, additionalSamples: number) => void;
  hasFastLearner?: boolean;
  showLPerSP?: boolean;
  getSkillMeta?: (skillId: string) => SkillSummaryMeta;
  className?: string;
};

function isSkillActionsMenuAllowedCloseReason(
  reason: MenuPrimitive.Root.ChangeEventDetails['reason']
): boolean {
  return reason === 'outside-press' || reason === 'item-press';
}

export const BasinnChart = (props: BasinnChartProps) => {
  'use no memo';

  const {
    selectedSkills,
    onAddSkill,
    showUmaIcons = false,
    onReplaceOutfit,
    isSimulationRunning,
    currentSeed = null,
    skillLoadingStates = {},
    onRunAdditionalSamples,
    hasFastLearner = false,
    showLPerSP = false,
    getSkillMeta,
    className
  } = props;

  const [expandedSkillId, setExpandedSkillId] = useState<string | null>(null);
  const [skillActionsAnchor, setSkillActionsAnchor] = useState<{
    skillId: string;
    element: Element;
  } | null>(null);
  const [skillDetailsAnchor, setSkillDetailsAnchor] = useState<{
    skillId: string;
    element: Element;
  } | null>(null);
  const [showSkillIds, setShowSkillIds] = useState(false);

  const skillMetadataById = useMemo(() => {
    const entries: Array<[string, SkillEntry]> = [];

    for (const row of props.data) {
      const skill = skillsService.getById(row.id);
      if (skill) {
        entries.push([row.id, skill]);
      }
    }

    return new Map(entries);
  }, [props.data]);

  const { iconTypeFilters, activeIconTypeFilters, filteredData, handleToggleIconTypeFilter } =
    useIconTypeFilter(props.data, skillMetadataById);

  const columns = useBassinColumns({
    showUmaIcons,
    showSkillIds,
    skillMetadataById,
    filteredData,
    showLPerSP,
    hasFastLearner,
    getSkillMeta
  });

  const handleGridClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const actionsEl = (e.target as HTMLElement).closest<HTMLElement>(
        `[data-event="${CSS.escape(BASSIN_DATA_EVENT_OPEN_SKILL_ACTIONS)}"]`
      );
      if (actionsEl) {
        const skillId = actionsEl.dataset.skillId;
        if (!skillId) return;
        if (!onReplaceOutfit) {
          onAddSkill(skillId);
          return;
        }
        setSkillActionsAnchor({ skillId, element: actionsEl });
        return;
      }

      const detailsEl = (e.target as HTMLElement).closest<HTMLElement>(
        `[data-event="${CSS.escape(BASSIN_DATA_EVENT_TOGGLE_SKILL_DETAILS)}"]`
      );
      if (detailsEl) {
        const skillId = detailsEl.dataset.skillId;
        if (!skillId) return;
        setSkillDetailsAnchor((prev) => {
          if (prev?.skillId === skillId) return null;
          return { skillId, element: detailsEl };
        });
        return;
      }

      const el = (e.target as HTMLElement).closest<HTMLElement>(
        `[data-event="${CSS.escape(BASSIN_DATA_EVENT_TOGGLE_ACTIVATION_DETAILS)}"]`
      );
      if (!el) return;

      const skillId = el.dataset.skillId;
      if (!skillId) return;

      setExpandedSkillId((prev) => (prev === skillId ? null : skillId));
    },
    [onAddSkill, onReplaceOutfit]
  );

  const handleGridKeyDown = useCallback((_event: React.KeyboardEvent<HTMLDivElement>) => {
    // TODO: Add full keyboard navigation for the interactive grid.
  }, []);

  const activationDetailsRow = useMemo(() => {
    if (!expandedSkillId) return null;
    return filteredData.find((r) => r.id === expandedSkillId) ?? null;
  }, [expandedSkillId, filteredData]);

  const activationDetailsDialogOpen =
    expandedSkillId !== null && activationDetailsRow?.runData != null;

  const [sorting, setSorting] = useState<SortingState>([{ id: 'mean', desc: true }]);
  const [rowSelection, setRowSelection] = useState({});

  const table = useReactTable({
    columns,
    data: filteredData,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onRowSelectionChange: setRowSelection,
    state: { sorting, rowSelection }
  });

  const { rows } = table.getRowModel();

  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizerOptions = useMemo(
    () => ({
      count: rows.length,
      getScrollElement: () => parentRef.current,
      estimateSize: () => 50,
      overscan: 30,
      getItemKey: (index: number) => rows[index].id,
      measureElement:
        typeof window !== 'undefined' && !navigator.userAgent.includes('Firefox')
          ? (element: Element) => element?.getBoundingClientRect().height
          : undefined
    }),
    [rows]
  );

  const virtualizer = useVirtualizer(virtualizerOptions);

  // Search functionality
  const searchOptions = useMemo(
    () => ({
      rows,
      getSearchableText: (row: Row<SkillComparisonRoundResult>) => {
        const skillId: string = row.getValue('id');
        return i18n.t(`skillnames.${skillId}`);
      },
      onScrollToRow: (index: number) => {
        virtualizer.scrollToIndex(index, { align: 'center' });
      }
    }),
    [rows, virtualizer]
  );

  const search = useTableSearch(searchOptions);

  const handleToggleSkillIds = useCallback(() => {
    setShowSkillIds((prev) => !prev);
  }, []);

  const handleSkillActionsMenuOpenChange = useCallback(
    (open: boolean, eventDetails: MenuPrimitive.Root.ChangeEventDetails) => {
      if (!open) {
        if (!isSkillActionsMenuAllowedCloseReason(eventDetails.reason)) {
          eventDetails.cancel();
          return;
        }
        setSkillActionsAnchor(null);
      }
    },
    []
  );

  return (
    <div className={cn('relative', className)}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <IconTypeFilterBar
          iconTypeFilters={iconTypeFilters}
          onToggle={handleToggleIconTypeFilter}
        />

        <Button variant="outline" size="sm" onClick={handleToggleSkillIds}>
          {showSkillIds ? 'Hide IDs' : 'Show IDs'}
        </Button>

        {activeIconTypeFilters.length < groups_filters.icontype.length && (
          <span className="text-sm text-muted-foreground">
            Showing {filteredData.length} / {props.data.length} skills
          </span>
        )}
      </div>

      {/* Search Bar */}
      <TableSearchBar
        searchQuery={search.searchQuery}
        onSearchChange={search.setSearchQuery}
        onClose={search.closeSearch}
        onNext={search.goToNextMatch}
        onPrevious={search.goToPreviousMatch}
        currentMatchIndex={search.currentMatchIndex}
        totalMatches={search.matches.length}
        hasMatches={search.hasMatches}
        searchInputRef={search.searchInputRef}
      />

      {/* Table Container */}
      <div
        ref={parentRef}
        className="overflow-auto relative min-h-[600px] max-h-[700px]"
        role="grid"
        tabIndex={0}
        aria-label="Skill comparison grid"
        onClick={handleGridClick}
        onKeyDown={handleGridKeyDown}
      >
        {/* Table */}
        <div className="min-w-[900px] w-full text-sm">
          {/* Table Header */}
          <div className="sticky top-0 z-30">
            <BassinTableHeader table={table} sorting={sorting} showLPerSP={showLPerSP} />
          </div>

          {/* Table Body */}
          {rows.length === 0 ? (
            <Empty className="min-h-[400px]">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Play />
                </EmptyMedia>
                <EmptyTitle>No simulation results yet</EmptyTitle>
                <EmptyDescription>
                  Run a simulation to compare skill performance here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <BassinTableBody
              virtualizer={virtualizer}
              rows={rows}
              selectedSkills={selectedSkills}
              expandedSkillId={expandedSkillId}
              search={search}
              hiddenSkills={props.hiddenSkills}
              isSimulationRunning={isSimulationRunning}
              showLPerSP={showLPerSP}
            />
          )}
        </div>
      </div>

      <SkillActivationDetailsDialog
        open={activationDetailsDialogOpen}
        onOpenChange={(open) => {
          if (!open) setExpandedSkillId(null);
        }}
        skillRow={activationDetailsRow}
        courseDistance={props.courseDistance ?? 1400}
        currentSeed={currentSeed}
        isGlobalSimulationRunning={isSimulationRunning}
        skillLoading={
          expandedSkillId != null ? (skillLoadingStates[expandedSkillId] ?? false) : false
        }
        onRunAdditionalSamples={onRunAdditionalSamples}
      />

      <Popover
        open={skillDetailsAnchor !== null}
        onOpenChange={(open) => {
          if (!open) setSkillDetailsAnchor(null);
        }}
      >
        <PopoverContent
          align="start"
          side="right"
          className="w-[420px] p-0"
          anchor={skillDetailsAnchor?.element ?? null}
        >
          {skillDetailsAnchor &&
            (() => {
              const skill = skillsService.getById(skillDetailsAnchor.skillId);
              if (!skill) {
                return (
                  <div className="p-3 text-sm text-muted-foreground">
                    Unknown skill {skillDetailsAnchor.skillId}
                  </div>
                );
              }
              return (
                <ExpandedSkillDetails
                  id={skillDetailsAnchor.skillId}
                  skill={skill}
                  distanceFactor={props.courseDistance}
                />
              );
            })()}
        </PopoverContent>
      </Popover>

      {onReplaceOutfit && (
        <DropdownMenu
          open={skillActionsAnchor !== null}
          onOpenChange={handleSkillActionsMenuOpenChange}
        >
          <DropdownMenuContent align="start" anchor={skillActionsAnchor?.element ?? null}>
            <DropdownMenuItem
              onClick={() => {
                if (!skillActionsAnchor) return;
                onAddSkill(skillActionsAnchor.skillId);
                setSkillActionsAnchor(null);
              }}
            >
              Add Skill to Runner
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                if (!skillActionsAnchor) return;
                onReplaceOutfit(skillActionsAnchor.skillId);
                setSkillActionsAnchor(null);
              }}
            >
              Replace Runner Outfit
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
};
