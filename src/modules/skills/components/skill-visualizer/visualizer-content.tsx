import { ChartNoAxesGantt, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { skillsService } from '@/modules/data/services/SkillService';
import { SkillDetails } from '@/modules/skills/components/skill-details';
import { SkillIcon } from '@/modules/skills/components/skill-list/skill-item/SkillIcon';
import {
  clearVisualizedSkills,
  MAX_VISUALIZED_SKILLS,
  removeVisualizedSkill,
  toggleFocusedVisualizedSkill,
  toggleVisualizedSkill,
  useSkillVisualizerStore
} from './store';
import { useSkillVisualizerData } from './use-skill-visualizer-data';
import type { SkillVisualizerEntry } from './use-skill-visualizer-data';
import { SkillVisualizerTrack } from './visualizer-track';
import { VisualizerTrackSelect } from './visualizer-track-select';

const STATUS_MESSAGES: Record<string, string> = {
  'no-activation': 'Does not activate on this course',
  unsupported: 'Cannot be simulated yet (unsupported conditions)'
};

type VisualizedSkillCardProps = {
  entry: SkillVisualizerEntry;
  courseDistance: number;
  isFocused: boolean;
};

function VisualizedSkillCard(props: VisualizedSkillCardProps) {
  const { entry, courseDistance, isFocused } = props;

  const skill = skillsService.getById(entry.skillId);
  const statusMessage = STATUS_MESSAGES[entry.status];
  const canFocus = entry.status === 'ok';

  return (
    <article
      className={cn(
        'flex min-w-0 flex-col rounded-lg border bg-card transition-colors',
        isFocused ? 'bg-accent/30' : 'hover:border-muted-foreground/40'
      )}
      style={
        isFocused
          ? { borderColor: entry.color, boxShadow: `inset 0 0 0 1px ${entry.color}` }
          : undefined
      }
    >
      <div className="flex items-center gap-1 pr-1">
        <button
          type="button"
          aria-pressed={isFocused}
          disabled={!canFocus}
          title={canFocus ? 'Spotlight this skill on the track' : undefined}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-3 py-2 text-left disabled:cursor-default"
          onClick={() => toggleFocusedVisualizedSkill(entry.skillId)}
        >
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          {entry.iconId && (
            <span className="shrink-0 [&_img]:size-6">
              <SkillIcon iconId={entry.iconId} />
            </span>
          )}

          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{entry.name}</span>
            {entry.contextLabel ? (
              <span className="block truncate text-[11px] text-muted-foreground">
                Activates {entry.contextLabel}
              </span>
            ) : statusMessage ? (
              <span className="block truncate text-[11px] text-muted-foreground">
                {statusMessage}
              </span>
            ) : null}
          </span>

          {isFocused && (
            <span
              className="ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
              style={{ backgroundColor: entry.color }}
            >
              Spotlight
            </span>
          )}
        </button>

        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Remove ${entry.name} from visualizer`}
          onClick={() => removeVisualizedSkill(entry.skillId)}
        >
          <XIcon />
        </Button>
      </div>

      {skill && (
        <div className="border-t px-3 py-2">
          <SkillDetails skill={skill} variant="plain" distanceFactor={courseDistance} />
        </div>
      )}
    </article>
  );
}

export function SkillVisualizerContent() {
  const { course, entries } = useSkillVisualizerData();
  const focusedSkillId = useSkillVisualizerStore((state) => state.focusedSkillId);

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

      <SkillVisualizerTrack course={course} entries={entries} focusedSkillId={focusedSkillId} />

      {hasSkills && (
        <>
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

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {entries.length} of {MAX_VISUALIZED_SKILLS} skills · click a skill to spotlight its
              windows on the track
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={clearVisualizedSkills}
            >
              Clear all
            </Button>
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            {entries.map((entry) => (
              <VisualizedSkillCard
                key={entry.skillId}
                entry={entry}
                courseDistance={course.distance}
                isFocused={focusedSkillId === entry.skillId}
              />
            ))}
          </div>
        </>
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
