import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChartNoAxesGantt, SearchIcon, UsersIcon } from 'lucide-react';

import { config } from '@/config';
import { Badge } from '@/components/ui/badge';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger
} from '@/components/ui/popover';
import i18n from '@/i18n';
import { describeValueScaling } from '@/lib/uma-domain/skills/value-scaling/registry';
import { skillsService } from '@/modules/data/services/SkillService';
import { umasService } from '@/modules/data/services/UmaService';
import { supportCardsService } from '@/modules/data/services/SupportCardService';
import type { SkillEntry, SkillUmaSourceEntry } from '@/modules/data/services/SkillService';
import { getUmaImageUrl } from '@/modules/runners/utils';
import { SkillPickerFilterRow } from '@/modules/skills/components/skill-picker/filter-row';
import { SkillPickerProvider } from '@/modules/skills/components/skill-picker/provider';
import {
  useFilteredSkills,
  useSkillPickerStore
} from '@/modules/skills/components/skill-picker/store';
import { SkillIcon } from '@/modules/skills/components/skill-list/skill-item/SkillIcon';
import { SkillDetails } from '@/modules/skills/components/skill-details';
import { useSkillVisualizerStore } from '@/modules/skills/components/skill-visualizer/store';
import { VisualizeSkillButton } from '@/modules/skills/components/skill-visualizer/visualizer-content';
import { formatEffect } from '@/modules/skills/components/formatters';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';

const SKILL_CARD_ESTIMATED_HEIGHT = 360;
const SKILL_CARD_GAP = 12;
const SKILL_LIST_OVERSCAN = 4;

function getRarityLabel(rarity: number) {
  if (rarity === 1) return 'White';
  if (rarity === 2) return 'Gold';
  if (rarity === 3) return 'Lesser Unique';
  if (rarity === 4) return 'Unique';
  if (rarity === 5) return 'Unique';
  if (rarity === 6) return 'Evolved';

  return `Rarity ${rarity}`;
}

type SkillFamilyProps = {
  skill: SkillEntry;
};

function getRelatedSkills(skill: SkillEntry) {
  const relatedIds = [
    ...skill.family.map((familySkill) => familySkill.id),
    skill.gene_version?.id,
    skill.unique_version?.id
  ].filter((id) => id !== undefined);

  const relatedById = new Map<string, SkillEntry>();
  for (const relatedId of relatedIds) {
    const relatedSkill = skillsService.getById(`${relatedId}`);
    if (relatedSkill && relatedSkill.id !== skill.id) {
      relatedById.set(relatedSkill.id, relatedSkill);
    }
  }

  return Array.from(relatedById.values()).sort((a, b) => b.rarity - a.rarity);
}

type SkillEffectSummaryProps = {
  alternative: SkillEntry['alternatives'][number] | undefined;
};

function SkillEffectSummary(props: SkillEffectSummaryProps) {
  const { alternative } = props;

  if (!alternative) {
    return <div className="text-xs text-muted-foreground">No effects.</div>;
  }

  return (
    <div className="grid gap-1.5">
      {!!alternative.cooldownTime && alternative.cooldownTime > 0 && (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 text-xs">
          <span className="min-w-0 text-muted-foreground">Cooldown</span>
          <span className="text-right font-medium">
            {i18n.t('skilldetails.seconds', { n: alternative.cooldownTime / 10000 })}
          </span>
        </div>
      )}

      {alternative.effects.map((effect, effectIndex) => {
        const modifier = effect.modifier / 10000;
        const effectType = formatEffect[effect.type as keyof typeof formatEffect];
        const effectValue =
          describeValueScaling({ ...effect, modifier }) ??
          (effectType ? effectType(modifier) : modifier);
        const effectLabel =
          effect.type === 9 && modifier < 0
            ? 'HP Drain'
            : i18n.t(`skilleffecttypes.${effect.type}`);
        const effectKey = `${effectIndex}-${effect.type}-${effect.target}-${effect.modifier}`;

        return (
          <div key={effectKey} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 text-xs">
            <span className="min-w-0 text-muted-foreground">{effectLabel}</span>
            <span className="text-right font-medium">{effectValue}</span>
          </div>
        );
      })}
    </div>
  );
}

type SkillAlternativeEffectSummaryProps = {
  skill: SkillEntry;
};

function SkillAlternativeEffectSummary(props: SkillAlternativeEffectSummaryProps) {
  const { skill } = props;

  if (skill.alternatives.length <= 1) {
    return <SkillEffectSummary alternative={skill.alternatives[0]} />;
  }

  return (
    <Tabs defaultValue={0}>
      <TabsList>
        {skill.alternatives.map((alternative, index) => {
          const alternativeKey = `${alternative.precondition ?? ''}-${alternative.condition}-${alternative.baseDuration}`;

          return (
            <TabsTrigger key={alternativeKey} value={index}>
              Alt {index + 1}
            </TabsTrigger>
          );
        })}
      </TabsList>

      {skill.alternatives.map((alternative, index) => {
        const alternativeKey = `${alternative.precondition ?? ''}-${alternative.condition}-${alternative.baseDuration}`;

        return (
          <TabsContent key={alternativeKey} value={index}>
            <SkillEffectSummary alternative={alternative} />
          </TabsContent>
        );
      })}
    </Tabs>
  );
}

type RelatedSkillPopoverProps = {
  skill: SkillEntry;
};

function getSourceRequirementLabel(needRank: number) {
  return needRank > 0 ? `Potential ${needRank}` : 'Base';
}

type SkillSourcesPopoverProps = {
  skill: SkillEntry;
};

function getSupportCardRarityLabel(rarity: number) {
  if (rarity === 1) return 'R';
  if (rarity === 2) return 'SR';
  if (rarity === 3) return 'SSR';
  return `Rarity ${rarity}`;
}

function getSupportCardImageUrl(cardId: number) {
  return `${config.basePath}img/support-cards/support_card_s_${cardId}.png`;
}

function SkillSourcesPopover(props: SkillSourcesPopoverProps) {
  const { skill } = props;
  const showUpcoming = useSkillPickerStore((state) => state.showUpcoming);

  const umaSources = useMemo(() => {
    const outfitIds = new Set<string>();
    const sourceEntries: SkillUmaSourceEntry[] = [];

    if (skill.sources?.length) {
      for (const source of skill.sources) {
        const outfitId = source.outfitId.toString();
        if ((!showUpcoming && !umasService.isReleased(outfitId)) || outfitIds.has(outfitId)) {
          continue;
        }

        sourceEntries.push(source);
      }
    }

    return sourceEntries;
  }, [skill.sources, showUpcoming]);

  const supportSources = useMemo(() => {
    const sources = skill.supportSources ?? [];

    if (showUpcoming) {
      return sources;
    }

    return sources.filter((source) => supportCardsService.isReleased(String(source.supportCardId)));
  }, [skill.supportSources, showUpcoming]);
  const sourceCount = umaSources.length + supportSources.length;
  const defaultSourceTab = umaSources.length > 0 ? 'umas' : 'support';

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" disabled={sourceCount === 0}>
            <UsersIcon />
            Sources{sourceCount > 0 ? ` (${sourceCount})` : ''}
          </Button>
        }
      />
      <PopoverContent
        align="start"
        className="w-95 border border-border bg-card p-4 text-card-foreground ring-0"
      >
        <PopoverHeader className="border-b border-border pb-3">
          <PopoverTitle className="text-xs">Sources</PopoverTitle>
          <PopoverDescription className="sr-only">{skill.name}</PopoverDescription>
        </PopoverHeader>

        {sourceCount > 0 ? (
          <Tabs defaultValue={defaultSourceTab} className="gap-2">
            <TabsList className="w-full">
              {umaSources.length > 0 ? (
                <TabsTrigger value="umas" className="flex-1">
                  Umas ({umaSources.length})
                </TabsTrigger>
              ) : null}
              {supportSources.length > 0 ? (
                <TabsTrigger value="support" className="flex-1">
                  Support cards ({supportSources.length})
                </TabsTrigger>
              ) : null}
            </TabsList>

            {umaSources.length > 0 ? (
              <TabsContent value="umas" className="mt-0">
                <div className="grid gap-1">
                  {umaSources.map((source) => (
                    <div
                      key={source.outfitId}
                      className="flex items-center gap-4 rounded-md bg-background p-2 text-foreground"
                    >
                      <img
                        src={getUmaImageUrl(source.outfitId.toString())}
                        alt=""
                        className="size-16 shrink-0 rounded-full object-cover"
                        loading="lazy"
                      />

                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="truncate text-xs text-muted-foreground">
                            {source.outfit}
                          </div>
                          <Badge variant="outline" className="h-4 rounded px-1 text-[10px]">
                            {getSourceRequirementLabel(source.needRank)}
                          </Badge>
                        </div>
                        <div className="truncate text-sm font-semibold leading-tight">
                          {source.name}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </TabsContent>
            ) : null}

            {supportSources.length > 0 ? (
              <TabsContent value="support" className="mt-0">
                <div className="grid max-h-60 gap-1 overflow-y-auto pr-1">
                  {supportSources.map((source) => (
                    <div
                      key={`${source.supportCardId}-${source.sourceType ?? 'hint'}`}
                      className="flex items-center gap-4 rounded-md bg-background p-2 text-foreground"
                    >
                      <img
                        src={getSupportCardImageUrl(source.supportCardId)}
                        alt=""
                        className="size-16 shrink-0 rounded-md object-cover"
                        loading="lazy"
                      />

                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <Badge variant="outline" className="h-4 rounded px-1 text-[10px]">
                            {getSupportCardRarityLabel(source.rarity)}
                          </Badge>
                          <div className="truncate text-xs text-muted-foreground">
                            Card {source.supportCardId}
                          </div>

                          <Badge variant="outline" className="h-4 rounded px-1 text-[10px]">
                            {source.sourceType === 'event' ? 'Event' : 'Hint'}
                          </Badge>
                        </div>

                        <div className="truncate text-sm font-semibold leading-tight">
                          {source.name || `Support ${source.supportCardId}`}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </TabsContent>
            ) : null}
          </Tabs>
        ) : (
          <div className="text-sm text-muted-foreground">No known sources.</div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function RelatedSkillPopover(props: RelatedSkillPopoverProps) {
  const { skill } = props;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm">
            <span className="[&_img]:size-4">
              <SkillIcon iconId={skill.iconId} />
            </span>
            <span className="min-w-0 truncate">{skill.name}</span>
          </Button>
        }
      />
      <PopoverContent align="start" className="min-w-50">
        <PopoverHeader>
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
            <SkillIcon iconId={skill.iconId} />

            <div className="min-w-0">
              <PopoverTitle className="truncate">{skill.name}</PopoverTitle>
              <PopoverDescription className="font-mono text-xs">{skill.id}</PopoverDescription>
            </div>
          </div>
        </PopoverHeader>

        <div className="flex gap-1">
          {skill.baseCost > 0 && <Badge variant="outline">{skill.baseCost} SP</Badge>}
          <Badge variant="outline">{getRarityLabel(skill.rarity)}</Badge>
        </div>

        <section className="grid gap-1.5">
          <div className="text-xs font-medium text-muted-foreground">Effects</div>

          <SkillAlternativeEffectSummary skill={skill} />
        </section>
      </PopoverContent>
    </Popover>
  );
}

function SkillFamily(props: SkillFamilyProps) {
  const { skill } = props;

  const familySkills = useMemo(() => {
    return getRelatedSkills(skill);
  }, [skill]);

  if (familySkills.length === 0) {
    return <div className="text-xs text-muted-foreground">None</div>;
  }

  return (
    <div className="flex flex-col md:flex-row gap-2">
      {familySkills.map((familySkill) => (
        <RelatedSkillPopover key={familySkill.id} skill={familySkill} />
      ))}
    </div>
  );
}

type SkillBrowserItemProps = {
  skill: SkillEntry;
};

function SkillBrowserItem(props: SkillBrowserItemProps) {
  const { skill } = props;

  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-card">
      <div className="flex flex-col md:flex-row md:items-center">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4 border-b px-4 py-2 md:border-none">
          <SkillIcon iconId={skill.iconId} />

          <div className="flex flex-col gap-2">
            <div className="text-sm">{skill.name}</div>

            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Badge variant="outline">
                <span>ID:</span>
                <span>{skill.id}</span>
              </Badge>

              <div className="flex gap-2">
                {skill.baseCost > 0 && <Badge variant="outline">{skill.baseCost} SP</Badge>}
                <Badge variant="outline">{getRarityLabel(skill.rarity)}</Badge>
                <SkillSourcesPopover skill={skill} />
                <VisualizeSkillButton skillId={skill.id} />
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4 px-4 py-2 border-b md:border-none">
          <section className="flex flex-col gap-2">
            <div className="text-xs text-muted-foreground">Related skills</div>
            <SkillFamily skill={skill} />
          </section>
        </div>
      </div>

      {skill.description || skill.lastUpdated ? (
        <div className="flex flex-col gap-1 border-b px-4 py-2 text-xs text-muted-foreground md:border-none">
          {skill.description ? <p className="leading-relaxed">{skill.description}</p> : null}
          {skill.lastUpdated ? (
            <p>
              Last updated: {skill.lastUpdated === 'unreleased' ? 'Unreleased' : skill.lastUpdated}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col px-4 text-xs md:py-2">
        <SkillDetails skill={skill} />
      </div>
    </div>
  );
}

function OpenVisualizerButton() {
  const selectedCount = useSkillVisualizerStore((state) => state.skillIds.length);

  return (
    <Button variant="outline" className="self-start" render={<Link to="/skill-visualizer" />}>
      <ChartNoAxesGantt />
      {selectedCount > 0 ? `Open visualizer (${selectedCount})` : 'Skill visualizer'}
    </Button>
  );
}

function SkillsBrowserContent() {
  const [searchText, setSearchText] = useState('');
  const deferredSearchText = useDeferredValue(searchText);

  const allSkills = useMemo(() => skillsService.getAll(), []);
  const filteredSkills = useFilteredSkills(deferredSearchText, allSkills);
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: filteredSkills.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => SKILL_CARD_ESTIMATED_HEIGHT,
    gap: SKILL_CARD_GAP,
    overscan: SKILL_LIST_OVERSCAN,
    getItemKey: (index) => filteredSkills[index]?.id ?? `skill-${index}`
  });

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-3 p-3 md:p-4">
      <div className="grid grid-cols md:grid-cols-12 min-h-0 flex-1 w-full gap-3">
        <header className="col-span-4 flex shrink-0 flex-col gap-2">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold leading-tight">Skills</h1>
            <div className="text-sm text-muted-foreground">
              {filteredSkills.length} of {allSkills.length} skills
            </div>
          </div>

          <InputGroup>
            <InputGroupAddon>
              <SearchIcon className="size-4" />
            </InputGroupAddon>
            <InputGroupInput
              type="text"
              value={searchText}
              placeholder="Search skill by name"
              onChange={(event) => setSearchText(event.target.value)}
            />
          </InputGroup>

          <SkillPickerFilterRow />

          <OpenVisualizerButton />
        </header>

        <div ref={parentRef} className="col-span-8 min-h-0 flex-1 overflow-y-auto pr-1">
          {filteredSkills.length > 0 ? (
            <div
              className="relative w-full"
              style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const skill = filteredSkills[virtualRow.index];
                if (!skill) return null;

                return (
                  <div
                    key={virtualRow.key}
                    ref={rowVirtualizer.measureElement}
                    className="absolute left-0 top-0 w-full"
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                    data-index={virtualRow.index}
                  >
                    <SkillBrowserItem skill={skill} />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center rounded-lg border">
              <div className="text-sm text-muted-foreground">
                No skills match the current filters.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function SkillsPage() {
  return (
    <SkillPickerProvider>
      <SkillsBrowserContent />
    </SkillPickerProvider>
  );
}
