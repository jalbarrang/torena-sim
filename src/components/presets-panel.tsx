import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import dayjs from 'dayjs';
import { GripVertical, RotateCcw, Trash2 } from 'lucide-react';
import { useMemo, useReducer } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Panel, PanelContent, PanelHeader, PanelTitle } from '@/components/ui/panel';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import {
  deletePreset,
  deletePresets,
  reorderPresets,
  resetPresets,
  usePresetStore
} from '@/store/race/preset.store';
import {
  setCourseId,
  setRaceParams,
  setSelectedPresetId,
  useSettingsStore
} from '@/store/settings.store';
import { createRaceConditions } from '@/utils/races';
import { cn } from '@/lib/utils';
import {
  EventType,
  GroundConditionName,
  SeasonName,
  WeatherName,
  type IGroundCondition,
  type ISeason,
  type IWeather
} from '@/lib/uma-domain/course/definitions';
import { getCourseById, getDistanceCategory } from '@/modules/racetrack/courses';
import { trackDescription } from '@/modules/racetrack/labels';
import i18n from '@/i18n';
import type { RacePreset } from '@/utils/races';

const PresetCourseDetails = ({ preset }: { preset: RacePreset }) => {
  const details = useMemo(() => {
    try {
      const course = getCourseById(preset.courseId);
      const trackName = i18n.t(`tracknames.${course.raceTrackId}`);
      const courseLabel = trackDescription({ courseid: preset.courseId });
      return `${trackName} \u00b7 ${courseLabel}`;
    } catch {
      return `Course ${preset.courseId}`;
    }
  }, [preset.courseId]);

  const conditions = useMemo(() => {
    const parts: string[] = [];
    parts.push(
      GroundConditionName[preset.ground as IGroundCondition] ?? `Ground ${preset.ground}`,
      SeasonName[preset.season as ISeason] ?? `Season ${preset.season}`,
      WeatherName[preset.weather as IWeather] ?? `Weather ${preset.weather}`
    );
    return parts.join(' \u00b7 ');
  }, [preset.ground, preset.season, preset.weather]);

  return (
    <div className="text-[11px] text-muted-foreground/70 leading-tight">
      <div className="truncate">{details}</div>
      <div className="truncate">{conditions}</div>
    </div>
  );
};

type SortablePresetItemProps = {
  preset: RacePreset;
  isSelected: boolean;
  isChecked: boolean;
  selectionMode: boolean;
  onLoad: (id: string) => void;
  onDeleteClick: (id: string, e: React.MouseEvent) => void;
  onToggleCheck: (id: string) => void;
};

const SortablePresetItem = ({
  preset,
  isSelected,
  isChecked,
  selectionMode,
  onLoad,
  onDeleteClick,
  onToggleCheck
}: SortablePresetItemProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: preset.id
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  };

  const handleActivate = () => {
    if (selectionMode) {
      onToggleCheck(preset.id);
    } else {
      onLoad(preset.id);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-2 p-4 border-b hover:bg-accent/50 cursor-pointer transition-colors',
        isSelected && 'bg-accent',
        isDragging && 'z-10 bg-accent/80 shadow-md'
      )}
      role="button"
      tabIndex={0}
      onClick={handleActivate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleActivate();
        }
      }}
    >
      <button
        type="button"
        className="touch-none cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing shrink-0"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>

      {selectionMode && (
        <Checkbox checked={isChecked} onClick={(e) => e.stopPropagation()} className="shrink-0" />
      )}

      <div className="flex flex-col gap-1 flex-1 min-w-0">
        <div className="font-medium truncate">{preset.name}</div>
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          <span>{dayjs(preset.date).format('YYYY-MM-DD')}</span>
          <span>&middot;</span>
          <span>{preset.type === EventType.CM ? 'CM' : 'LOH'}</span>
        </div>
        <PresetCourseDetails preset={preset} />
      </div>

      {!selectionMode && (
        <Button variant="destructive" size="icon" onClick={(e) => onDeleteClick(preset.id, e)}>
          <Trash2 />
        </Button>
      )}
    </div>
  );
};

type FilterSurface = 'all' | 'turf' | 'dirt';
type FilterDistanceType = 'all' | 'sprint' | 'mile' | 'medium' | 'long';
type FilterRaceType = 'all' | 'cm' | 'loh';

function getPresetSurface(preset: RacePreset): 'turf' | 'dirt' | null {
  try {
    const course = getCourseById(preset.courseId);
    return course.surface === 1 ? 'turf' : 'dirt';
  } catch {
    return null;
  }
}

function getPresetDistanceCategory(preset: RacePreset): string | null {
  try {
    const course = getCourseById(preset.courseId);
    return getDistanceCategory(course.distance);
  } catch {
    return null;
  }
}

type PresetsPanelState = {
  deleteDialogOpen: boolean;
  presetToDelete: string | null;
  selectionMode: boolean;
  checkedIds: Set<string>;
  bulkDeleteDialogOpen: boolean;
  resetDialogOpen: boolean;
  filterSurface: FilterSurface;
  filterDistance: FilterDistanceType;
  filterRaceType: FilterRaceType;
};

type PresetsPanelAction =
  | { type: 'delete:open'; presetId: string }
  | { type: 'delete:dialogOpenChange'; open: boolean }
  | { type: 'delete:confirmed' }
  | { type: 'selection:enter' }
  | { type: 'selection:exit' }
  | { type: 'selection:toggle'; id: string }
  | { type: 'selection:selectAll'; ids: string[] }
  | { type: 'bulkDelete:open' }
  | { type: 'bulkDelete:dialogOpenChange'; open: boolean }
  | { type: 'bulkDelete:confirmed' }
  | { type: 'reset:dialogOpenChange'; open: boolean }
  | { type: 'reset:confirmed' }
  | { type: 'filter:surface'; value: FilterSurface }
  | { type: 'filter:distance'; value: FilterDistanceType }
  | { type: 'filter:raceType'; value: FilterRaceType }
  | { type: 'filters:clear' };

function createInitialPresetsPanelState(): PresetsPanelState {
  return {
    deleteDialogOpen: false,
    presetToDelete: null,
    selectionMode: false,
    checkedIds: new Set(),
    bulkDeleteDialogOpen: false,
    resetDialogOpen: false,
    filterSurface: 'all',
    filterDistance: 'all',
    filterRaceType: 'all'
  };
}

function presetsPanelReducer(
  state: PresetsPanelState,
  action: PresetsPanelAction
): PresetsPanelState {
  switch (action.type) {
    case 'delete:open':
      return { ...state, presetToDelete: action.presetId, deleteDialogOpen: true };
    case 'delete:dialogOpenChange':
      return {
        ...state,
        deleteDialogOpen: action.open,
        presetToDelete: action.open ? state.presetToDelete : null
      };
    case 'delete:confirmed':
      return { ...state, deleteDialogOpen: false, presetToDelete: null };
    case 'selection:enter':
      return { ...state, selectionMode: true };
    case 'selection:exit':
      return { ...state, selectionMode: false, checkedIds: new Set() };
    case 'selection:toggle': {
      const next = new Set(state.checkedIds);
      if (next.has(action.id)) next.delete(action.id);
      else next.add(action.id);
      return { ...state, checkedIds: next };
    }
    case 'selection:selectAll': {
      const allSelected =
        state.checkedIds.size === action.ids.length &&
        action.ids.every((id) => state.checkedIds.has(id));
      return {
        ...state,
        checkedIds: allSelected ? new Set() : new Set(action.ids)
      };
    }
    case 'bulkDelete:open':
      return state.checkedIds.size > 0 ? { ...state, bulkDeleteDialogOpen: true } : state;
    case 'bulkDelete:dialogOpenChange':
      return { ...state, bulkDeleteDialogOpen: action.open };
    case 'bulkDelete:confirmed':
      return {
        ...state,
        bulkDeleteDialogOpen: false,
        selectionMode: false,
        checkedIds: new Set()
      };
    case 'reset:dialogOpenChange':
      return { ...state, resetDialogOpen: action.open };
    case 'reset:confirmed':
      return { ...state, resetDialogOpen: false };
    case 'filter:surface':
      return { ...state, filterSurface: action.value };
    case 'filter:distance':
      return { ...state, filterDistance: action.value };
    case 'filter:raceType':
      return { ...state, filterRaceType: action.value };
    case 'filters:clear':
      return {
        ...state,
        filterSurface: 'all',
        filterDistance: 'all',
        filterRaceType: 'all'
      };
    default:
      return state;
  }
}

export const PresetsPanel = () => {
  const { presets, presetOrder } = usePresetStore();
  const selectedPresetId = useSettingsStore((state) => state.selectedPresetId);

  const [panel, dispatch] = useReducer(
    presetsPanelReducer,
    undefined,
    createInitialPresetsPanelState
  );

  const allPresets = useMemo(() => {
    const ordered: RacePreset[] = [];

    for (const id of presetOrder) {
      const preset = presets[id];
      if (preset) {
        ordered.push(preset);
      }
    }

    const orderSet = new Set(presetOrder);
    const extra = Object.values(presets).filter((preset) => !orderSet.has(preset.id));
    return [...ordered, ...extra];
  }, [presets, presetOrder]);

  const hasActiveFilter =
    panel.filterSurface !== 'all' ||
    panel.filterDistance !== 'all' ||
    panel.filterRaceType !== 'all';

  const presetList = useMemo(() => {
    if (!hasActiveFilter) return allPresets;
    return allPresets.filter((p) => {
      if (panel.filterRaceType !== 'all') {
        const isMatch =
          panel.filterRaceType === 'cm' ? p.type === EventType.CM : p.type === EventType.LOH;
        if (!isMatch) return false;
      }
      if (panel.filterSurface !== 'all') {
        const surface = getPresetSurface(p);
        if (surface !== panel.filterSurface) return false;
      }
      if (panel.filterDistance !== 'all') {
        const cat = getPresetDistanceCategory(p);
        if (cat !== panel.filterDistance) return false;
      }
      return true;
    });
  }, [
    allPresets,
    hasActiveFilter,
    panel.filterSurface,
    panel.filterDistance,
    panel.filterRaceType
  ]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleLoadPreset = (presetId: string) => {
    const preset = presets[presetId];
    setCourseId(preset.courseId);
    setRaceParams(
      createRaceConditions({
        ground: preset.ground,
        weather: preset.weather,
        season: preset.season,
        time: preset.time
      })
    );
    setSelectedPresetId(presetId);
    toast.success(`Loaded preset: ${preset.name}`);
  };

  const handleDeleteClick = (presetId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch({ type: 'delete:open', presetId });
  };

  const handleConfirmDelete = () => {
    if (panel.presetToDelete) {
      const preset = presets[panel.presetToDelete];
      deletePreset(panel.presetToDelete);

      if (selectedPresetId === panel.presetToDelete) {
        setSelectedPresetId(null);
      }

      toast.success(`Deleted preset: ${preset.name}`);
      dispatch({ type: 'delete:confirmed' });
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const ids = presetList.map((p) => p.id);
    const oldIndex = ids.indexOf(active.id as string);
    const newIndex = ids.indexOf(over.id as string);
    reorderPresets(arrayMove(ids, oldIndex, newIndex));
  };

  const handleToggleCheck = (id: string) => {
    dispatch({ type: 'selection:toggle', id });
  };

  const handleToggleSelectAll = () => {
    dispatch({ type: 'selection:selectAll', ids: presetList.map((p) => p.id) });
  };

  const handleBulkDelete = () => {
    dispatch({ type: 'bulkDelete:open' });
  };

  const handleConfirmBulkDelete = () => {
    const ids = [...panel.checkedIds];
    deletePresets(ids);

    if (selectedPresetId && panel.checkedIds.has(selectedPresetId)) {
      setSelectedPresetId(null);
    }

    toast.success(`Deleted ${ids.length} preset${ids.length > 1 ? 's' : ''}`);
    dispatch({ type: 'bulkDelete:confirmed' });
  };

  return (
    <>
      <Panel>
        <PanelHeader>
          <div className="flex items-center justify-between">
            <PanelTitle>Race Presets</PanelTitle>
            {presetList.length > 0 && (
              <div className="flex items-center gap-1">
                {panel.selectionMode ? (
                  <>
                    <Button variant="outline" size="sm" onClick={handleToggleSelectAll}>
                      {panel.checkedIds.size === presetList.length ? 'Deselect All' : 'Select All'}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={panel.checkedIds.size === 0}
                      onClick={handleBulkDelete}
                    >
                      <Trash2 className="mr-1" />
                      Delete ({panel.checkedIds.size})
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => dispatch({ type: 'selection:exit' })}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => dispatch({ type: 'reset:dialogOpenChange', open: true })}
                    >
                      <RotateCcw className="mr-1" />
                      Reset
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => dispatch({ type: 'selection:enter' })}
                    >
                      Bulk actions
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        </PanelHeader>

        <div className="flex items-center gap-2 px-4 py-2 border-b">
          <Select
            value={panel.filterSurface}
            onValueChange={(v) => dispatch({ type: 'filter:surface', value: v as FilterSurface })}
          >
            <SelectTrigger size="sm" className="w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Surface</SelectItem>
              <SelectItem value="turf">Turf</SelectItem>
              <SelectItem value="dirt">Dirt</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={panel.filterDistance}
            onValueChange={(v) =>
              dispatch({ type: 'filter:distance', value: v as FilterDistanceType })
            }
          >
            <SelectTrigger size="sm" className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Distance</SelectItem>
              <SelectItem value="sprint">Sprint</SelectItem>
              <SelectItem value="mile">Mile</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="long">Long</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={panel.filterRaceType}
            onValueChange={(v) => dispatch({ type: 'filter:raceType', value: v as FilterRaceType })}
          >
            <SelectTrigger size="sm" className="w-18">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Type</SelectItem>
              <SelectItem value="cm">CM</SelectItem>
              <SelectItem value="loh">LOH</SelectItem>
            </SelectContent>
          </Select>

          {hasActiveFilter && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7 px-2"
              onClick={() => dispatch({ type: 'filters:clear' })}
            >
              Clear
            </Button>
          )}
        </div>

        <PanelContent className="p-0">
          {presetList.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 text-center">
              {hasActiveFilter ? (
                <p className="text-sm text-muted-foreground">
                  No presets match the current filters.
                </p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">No presets saved yet.</p>
                  <p className="text-xs text-muted-foreground mt-2">
                    Save your race settings as presets for quick access.
                  </p>
                </>
              )}
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={presetList.map((p) => p.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="flex flex-col">
                  {presetList.map((preset) => (
                    <SortablePresetItem
                      key={preset.id}
                      preset={preset}
                      isSelected={selectedPresetId === preset.id}
                      isChecked={panel.checkedIds.has(preset.id)}
                      selectionMode={panel.selectionMode}
                      onLoad={handleLoadPreset}
                      onDeleteClick={handleDeleteClick}
                      onToggleCheck={handleToggleCheck}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </PanelContent>
      </Panel>

      <AlertDialog
        open={panel.deleteDialogOpen}
        onOpenChange={(open) => dispatch({ type: 'delete:dialogOpenChange', open })}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Preset</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{' '}
              <span className="font-semibold">
                {panel.presetToDelete ? presets[panel.presetToDelete]?.name : ''}
              </span>
              ? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={panel.bulkDeleteDialogOpen}
        onOpenChange={(open) => dispatch({ type: 'bulkDelete:dialogOpenChange', open })}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {panel.checkedIds.size} Preset{panel.checkedIds.size > 1 ? 's' : ''}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {panel.checkedIds.size} selected preset
              {panel.checkedIds.size > 1 ? 's' : ''}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmBulkDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={panel.resetDialogOpen}
        onOpenChange={(open) => dispatch({ type: 'reset:dialogOpenChange', open })}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset to Default Presets</AlertDialogTitle>
            <AlertDialogDescription>
              This will replace all presets with the bundled CM defaults. Any custom presets you
              created will be removed. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                resetPresets();
                setSelectedPresetId(null);
                dispatch({ type: 'reset:confirmed' });
                toast.success('Presets reset to defaults');
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
