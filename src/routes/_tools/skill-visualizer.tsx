import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, SearchIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxList,
  ComboboxTrigger
} from '@/components/ui/combobox';
import { skillsService } from '@/modules/data/services/SkillService';
import { SkillIcon } from '@/modules/skills/components/skill-list/skill-item/SkillIcon';
import {
  MAX_VISUALIZED_SKILLS,
  setVisualizedSkills,
  useSkillVisualizerStore
} from '@/modules/skills/components/skill-visualizer/store';
import { SkillVisualizerContent } from '@/modules/skills/components/skill-visualizer/visualizer-content';
import { useVisualizerImport } from '@/modules/skills/components/skill-visualizer/use-visualizer-import';

const MAX_SEARCH_RESULTS = 20;

type SkillOption = {
  value: string;
  label: string;
  iconId: string;
};

function SkillSearch() {
  const skillIds = useSkillVisualizerStore((state) => state.skillIds);
  const [inputValue, setInputValue] = useState('');

  const options = useMemo<Array<SkillOption>>(
    () =>
      skillsService
        .getAll()
        .map((skill) => ({ value: skill.id, label: skill.name, iconId: skill.iconId })),
    []
  );

  const optionsById = useMemo(
    () => new Map(options.map((option) => [option.value, option])),
    [options]
  );

  const selectedOptions = useMemo(
    () =>
      skillIds.map((skillId) => optionsById.get(skillId)).filter((option) => option !== undefined),
    [skillIds, optionsById]
  );

  const filteredOptions = useMemo(() => {
    const query = inputValue.trim().toLowerCase();
    if (!query) return [];

    return options
      .filter((option) => option.label.toLowerCase().includes(query))
      .slice(0, MAX_SEARCH_RESULTS);
  }, [inputValue, options]);

  const isFull = skillIds.length >= MAX_VISUALIZED_SKILLS;

  return (
    <div className="flex w-full flex-col gap-1 md:max-w-md">
      <Combobox
        items={options}
        filteredItems={filteredOptions}
        multiple
        value={selectedOptions}
        onValueChange={(nextValue) => setVisualizedSkills(nextValue.map((option) => option.value))}
        onInputValueChange={setInputValue}
        itemToStringLabel={(option: SkillOption) => option.label}
        itemToStringValue={(option: SkillOption) => option.value}
        isItemEqualToValue={(item: SkillOption, selectedItem: SkillOption) =>
          item.value === selectedItem.value
        }
      >
        <div className="flex h-9 w-full items-center rounded-lg border border-input dark:bg-input/30">
          <SearchIcon className="ml-2.5 size-4 shrink-0 text-muted-foreground" />
          <ComboboxInput
            className="h-8 border-0 bg-transparent focus-visible:ring-0"
            placeholder="Search skill by name to add it"
          />
          <ComboboxTrigger />
        </div>

        <ComboboxContent className="max-h-80">
          <ComboboxEmpty>
            {inputValue.trim() ? 'No skills found.' : 'Type to search skills.'}
          </ComboboxEmpty>
          <ComboboxList>
            {(skill: SkillOption, index: number) => (
              <ComboboxItem key={skill.value} value={skill} index={index}>
                <span className="[&_img]:size-5">
                  <SkillIcon iconId={skill.iconId} />
                </span>
                <span className="min-w-0 flex-1 truncate">{skill.label}</span>
                <ComboboxItemIndicator />
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>

      {isFull && (
        <div className="text-xs text-muted-foreground">
          Limit of {MAX_VISUALIZED_SKILLS} skills reached. Remove one to add another.
        </div>
      )}
    </div>
  );
}

export function SkillVisualizerPage() {
  useVisualizerImport();

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-3 p-3 md:p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold leading-tight">Skill Visualizer</h1>
          <div className="text-sm text-muted-foreground">
            See where skill conditions can activate on a given track.
          </div>
        </div>

        <Button variant="outline" render={<Link to="/skills" />}>
          Browse skills
          <ArrowRight />
        </Button>
      </header>

      <SkillSearch />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <SkillVisualizerContent />
      </div>
    </div>
  );
}
