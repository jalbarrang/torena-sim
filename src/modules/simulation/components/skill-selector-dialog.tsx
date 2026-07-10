import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { SearchIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useIsMobile } from '@/hooks/use-mobile';
import type { SkillEntry } from '@/modules/data/services/SkillService';
import { SkillPickerFilterRow } from '@/modules/skills/components/skill-picker/filter-row';
import { SkillPickerProvider } from '@/modules/skills/components/skill-picker/provider';
import {
  hasActiveSkillPickerFilters,
  type SkillPickerFilterGroup,
  useFilteredSkills,
  useSkillPickerStore
} from '@/modules/skills/components/skill-picker/store';
import { SkillPickerVirtualGrid } from '@/modules/skills/components/skill-picker/virtual-grid';
import { umasService } from '@/modules/data/services/UmaService';
import { getUmaImageUrl } from '@/modules/runners/utils';
import { SkillIcon } from '@/modules/skills/components/skill-list/skill-item/SkillIcon';
import { getUmaForUniqueSkill } from '@/modules/skills/utils';
import { useActivatableSkillsForRace } from '@/modules/simulation/hooks/skill-bassin/useActivatableSkillsForRace';
import type { ActivatableSkillPool } from '@/modules/simulation/utils/skill-bassin-skills';
import {
  deselectAllSkills,
  reconcileSkillSelectionForPool,
  resetSkillSelectionForRace,
  selectAllSkills,
  toggleSkillSelected,
  useSkillSelectionStore
} from '../stores/skill-selection.store';
import {
  deselectAllUmaSkills,
  reconcileUmaSkillSelectionForPool,
  resetUmaSkillSelectionForRace,
  selectAllUmaSkills,
  toggleUmaSkillSelected,
  useUmaSkillSelectionStore
} from '../stores/uma-skill-selection.store';

const BASSIN_HIDDEN_FILTER_GROUPS = new Set<SkillPickerFilterGroup>([
  'strategy',
  'distance',
  'surface'
]);

const RACE_SETTINGS_DESCRIPTION =
  'Listed skills match your current race settings above. Changing those settings refreshes the list and re-selects all matching released skills.';

type SkillSelectionActions = {
  useSelectedSkillIds: () => Set<string>;
  toggle: (skillId: string) => void;
  selectAll: (skillIds: Array<string>) => void;
  deselectAll: (skillIds: Array<string>) => void;
  resetForRace: (releasedActivatableIds: Array<string>) => void;
  reconcileForPool: (releasedActivatableIds: Array<string>) => void;
};

type SkillSelectorDialogLabels = {
  trigger: string;
  title: string;
  description: string;
};

type SkillRowProps = {
  skill: SkillEntry;
  selected: boolean;
  showUpcomingBadge: boolean;
  released: boolean;
  showUmaOutfitImage?: boolean;
  onToggle: (skillId: string) => void;
};

function getOutfitIdForUniqueSkill(skill: SkillEntry): string | undefined {
  const fromService = umasService.umaForUniqueSkill(skill.id);
  if (fromService) return fromService;

  const fromCharacter = skill.character?.[0];
  if (fromCharacter !== undefined) return fromCharacter.toString();

  try {
    return getUmaForUniqueSkill(skill.id);
  } catch {
    return undefined;
  }
}

const SkillRow = memo((props: SkillRowProps) => {
  const {
    skill,
    selected,
    showUpcomingBadge,
    released,
    showUmaOutfitImage = false,
    onToggle
  } = props;

  const outfitImageUrl = useMemo(() => {
    if (!showUmaOutfitImage) return undefined;
    return getUmaImageUrl(getOutfitIdForUniqueSkill(skill));
  }, [skill, showUmaOutfitImage]);

  return (
    <button
      type="button"
      className="flex h-full w-full items-center gap-2 rounded px-2 py-1 text-left transition-colors cursor-pointer hover:bg-muted"
      onClick={() => onToggle(skill.id)}
    >
      <Checkbox checked={selected} tabIndex={-1} className="pointer-events-none" />
      {showUmaOutfitImage && outfitImageUrl ? (
        <img src={outfitImageUrl} alt="" className="size-8 shrink-0 rounded-sm object-cover" />
      ) : (
        <SkillIcon iconId={skill.iconId} />
      )}
      <span className="min-w-0 flex-1 truncate text-xs">{skill.name}</span>
      {showUpcomingBadge && !released && (
        <Badge variant="outline" className="shrink-0 text-[10px] opacity-60">
          Upcoming
        </Badge>
      )}
    </button>
  );
});

type SkillSelectorPanelContentProps = {
  skills: Array<SkillEntry>;
  releasedIds: Set<string>;
  selection: SkillSelectionActions;
  listEnabled: boolean;
  columnCount: number;
  showUpcomingBadge?: boolean;
  showUmaOutfitImage?: boolean;
};

type SkillSelectorPanelProps = SkillSelectorPanelContentProps & {
  panelKey: string;
};

function SkillSelectorPanel(props: SkillSelectorPanelProps) {
  const { panelKey, ...contentProps } = props;

  return (
    <SkillPickerProvider key={panelKey}>
      <SkillSelectorPanelContent {...contentProps} />
    </SkillPickerProvider>
  );
}

function SkillSelectorPanelContent(props: SkillSelectorPanelContentProps) {
  const {
    skills,
    releasedIds,
    selection,
    listEnabled,
    columnCount,
    showUpcomingBadge = true,
    showUmaOutfitImage = false
  } = props;

  const selectedSkillIds = selection.useSelectedSkillIds();
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);

  const filters = useSkillPickerStore((state) => state.filters);
  const filteredSkills = useFilteredSkills(deferredSearch, skills, { showUpcoming: true });

  const filteredCount = filteredSkills.length;
  const hasNarrowedList =
    search.trim().length > 0 || hasActiveSkillPickerFilters(filters, BASSIN_HIDDEN_FILTER_GROUPS);
  const countSuffix = hasNarrowedList ? ` (${filteredCount})` : '';

  const handleSelectAll = useCallback(() => {
    selection.selectAll(filteredSkills.map((s) => s.id));
  }, [filteredSkills, selection]);

  const handleDeselectAll = useCallback(() => {
    selection.deselectAll(filteredSkills.map((s) => s.id));
  }, [filteredSkills, selection]);

  const handleClearSearch = useCallback(() => {
    setSearch('');
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon className="size-4" />
        </InputGroupAddon>
        <InputGroupInput
          type="text"
          value={search}
          placeholder="Search skill by name"
          onChange={(e) => setSearch(e.target.value)}
        />
      </InputGroup>

      <SkillPickerFilterRow
        showUpcomingToggle={false}
        hiddenFilterGroups={BASSIN_HIDDEN_FILTER_GROUPS}
        onAfterClear={handleClearSearch}
        hasAdditionalFilters={search.trim().length > 0}
      />

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={filteredCount === 0}
          onClick={handleSelectAll}
        >
          Select All{countSuffix}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={filteredCount === 0}
          onClick={handleDeselectAll}
        >
          Deselect all{countSuffix}
        </Button>
      </div>

      <SkillPickerVirtualGrid
        filteredSkills={filteredSkills}
        columnCount={columnCount}
        enabled={listEnabled}
        renderItem={({ skill }) => (
          <SkillRow
            skill={skill}
            selected={selectedSkillIds.has(skill.id)}
            released={releasedIds.has(skill.id)}
            showUpcomingBadge={showUpcomingBadge}
            showUmaOutfitImage={showUmaOutfitImage}
            onToggle={selection.toggle}
          />
        )}
      />
    </div>
  );
}

type SkillSelectorDialogBaseProps = {
  pool: ActivatableSkillPool;
  labels: SkillSelectorDialogLabels;
  selection: SkillSelectionActions;
  showUmaOutfitImage?: boolean;
};

function SkillSelectorDialogBase(props: SkillSelectorDialogBaseProps) {
  const { pool, labels, selection, showUmaOutfitImage = false } = props;
  const isMobile = useIsMobile();
  const columnCount = isMobile ? 1 : 4;

  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'released' | 'upcoming'>('released');

  const {
    raceSettingsKey,
    raceOnlyKey,
    allSkills,
    releasedIds,
    releasedSkills,
    upcomingSkills,
    releasedActivatableIds
  } = useActivatableSkillsForRace(pool);

  const selectedSkillIds = selection.useSelectedSkillIds();
  const previousRaceOnlyKey = useRef<string | null>(null);

  useEffect(() => {
    if (previousRaceOnlyKey.current === null || previousRaceOnlyKey.current !== raceOnlyKey) {
      selection.resetForRace(releasedActivatableIds);
    } else {
      selection.reconcileForPool(releasedActivatableIds);
    }

    previousRaceOnlyKey.current = raceOnlyKey;
  }, [raceOnlyKey, releasedActivatableIds, selection]);

  const selectedCount = selectedSkillIds.size;
  const totalCount = allSkills.length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline">
            {labels.trigger}
            <Badge variant="default">{selectedCount}</Badge>
          </Button>
        }
      />

      <DialogContent className="flex h-dvh max-w-full min-h-0 flex-col md:h-[90dvh] md:max-w-[1200px]!">
        <DialogHeader>
          <DialogTitle>
            {labels.title}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {selectedCount} / {totalCount}
            </span>
          </DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col">
          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as 'released' | 'upcoming')}
            className="flex min-h-0 flex-1 flex-col"
          >
            <TabsList className="h-10! w-full">
              <TabsTrigger value="released" className="flex-1">
                Released ({releasedSkills.length})
              </TabsTrigger>
              <TabsTrigger value="upcoming" className="flex-1">
                Upcoming ({upcomingSkills.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent
              value="released"
              className="mt-0 flex min-h-0 flex-1 flex-col data-hidden:hidden"
            >
              <SkillSelectorPanel
                panelKey={`${pool}-released-${raceSettingsKey}`}
                skills={releasedSkills}
                releasedIds={releasedIds}
                selection={selection}
                listEnabled={open && activeTab === 'released'}
                columnCount={columnCount}
                showUpcomingBadge
                showUmaOutfitImage={showUmaOutfitImage}
              />
            </TabsContent>

            <TabsContent
              value="upcoming"
              className="mt-0 flex min-h-0 flex-1 flex-col data-hidden:hidden"
            >
              <SkillSelectorPanel
                panelKey={`${pool}-upcoming-${raceSettingsKey}`}
                skills={upcomingSkills}
                releasedIds={releasedIds}
                selection={selection}
                listEnabled={open && activeTab === 'upcoming'}
                columnCount={columnCount}
                showUpcomingBadge={false}
                showUmaOutfitImage={showUmaOutfitImage}
              />
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const skillBassinSelection: SkillSelectionActions = {
  useSelectedSkillIds: () => useSkillSelectionStore((state) => state.selectedSkillIds),
  toggle: toggleSkillSelected,
  selectAll: selectAllSkills,
  deselectAll: deselectAllSkills,
  resetForRace: resetSkillSelectionForRace,
  reconcileForPool: reconcileSkillSelectionForPool
};

const umaBassinSelection: SkillSelectionActions = {
  useSelectedSkillIds: () => useUmaSkillSelectionStore((state) => state.selectedSkillIds),
  toggle: toggleUmaSkillSelected,
  selectAll: selectAllUmaSkills,
  deselectAll: deselectAllUmaSkills,
  resetForRace: resetUmaSkillSelectionForRace,
  reconcileForPool: reconcileUmaSkillSelectionForPool
};

export function SkillSelectorDialog() {
  return (
    <SkillSelectorDialogBase
      pool="base"
      labels={{
        trigger: 'Skills to simulate',
        title: 'Skills to simulate',
        description: RACE_SETTINGS_DESCRIPTION
      }}
      selection={skillBassinSelection}
    />
  );
}

export function UmaSkillSelectorDialog() {
  return (
    <SkillSelectorDialogBase
      pool="unique"
      showUmaOutfitImage
      labels={{
        trigger: 'Unique skills to simulate',
        title: 'Unique skills to simulate',
        description: RACE_SETTINGS_DESCRIPTION
      }}
      selection={umaBassinSelection}
    />
  );
}
