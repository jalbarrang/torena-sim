import { ChartNoAxesGantt, XIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SkillIcon } from '@/modules/skills/components/skill-list/skill-item/SkillIcon';
import {
  clearVisualizedSkills,
  MAX_VISUALIZED_SKILLS,
  removeVisualizedSkill,
  toggleVisualizedSkill,
  useSkillVisualizerStore
} from './store';
import { useSkillVisualizerData } from './use-skill-visualizer-data';
import { SkillVisualizerTrack } from './visualizer-track';
import { VisualizerTrackSelect } from './visualizer-track-select';

export function SkillVisualizerContent() {
  const { course, entries } = useSkillVisualizerData();

  const hasSkills = entries.length > 0;
  const hasDynamicConditions = entries.some((entry) =>
    entry.triggers.some((trigger) => trigger.hasDynamicCondition)
  );
  const hasContextLabels = entries.some((entry) => entry.contextLabel);

  return (
    <div className="flex flex-col gap-3">
      <VisualizerTrackSelect className="flex flex-col md:flex-row items-center gap-2 w-full md:w-auto" />

      {!hasSkills && (
        <div className="text-sm text-muted-foreground">
          No skills selected. Search for a skill above, or use the Visualize button on the Skills
          page.
        </div>
      )}

      <SkillVisualizerTrack course={course} entries={entries} />

      {hasSkills && (
        <div className="flex flex-wrap items-center gap-1.5">
          {entries.map((entry) => (
            <Badge
              key={entry.skillId}
              variant="outline"
              className="gap-1.5 pr-1"
              style={{ borderColor: entry.color }}
            >
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              {entry.iconId && (
                <span className="[&_img]:size-4">
                  <SkillIcon iconId={entry.iconId} />
                </span>
              )}
              <span className="max-w-48 truncate">{entry.name}</span>
              <button
                type="button"
                aria-label={`Remove ${entry.name} from visualizer`}
                className="cursor-pointer rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => removeVisualizedSkill(entry.skillId)}
              >
                <XIcon className="size-3" />
              </button>
            </Badge>
          ))}

          {entries.length >= MAX_VISUALIZED_SKILLS && (
            <span className="text-xs text-muted-foreground">Limit reached</span>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={clearVisualizedSkills}
          >
            Clear all
          </Button>
        </div>
      )}

      {hasSkills && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span>Solid band: activates at the marked start of the window.</span>
          <span>Dashed band: activates at a random point inside the window.</span>
          {hasDynamicConditions && (
            <span>
              * has extra runtime conditions (position, HP, surroundings…) that must also be met
              during the race.
            </span>
          )}
          {hasContextLabels && (
            <span>
              Labels in parentheses show the strategy or conditions required for activation.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

type VisualizeSkillButtonProps = {
  skillId: string;
};

export function VisualizeSkillButton(props: VisualizeSkillButtonProps) {
  const { skillId } = props;

  const isSelected = useSkillVisualizerStore((state) => state.skillIds.includes(skillId));
  const isFull = useSkillVisualizerStore((state) => state.skillIds.length >= MAX_VISUALIZED_SKILLS);

  return (
    <Button
      variant={isSelected ? 'default' : 'outline'}
      size="sm"
      disabled={!isSelected && isFull}
      onClick={() => toggleVisualizedSkill(skillId)}
    >
      <ChartNoAxesGantt />
      Visualize
    </Button>
  );
}
