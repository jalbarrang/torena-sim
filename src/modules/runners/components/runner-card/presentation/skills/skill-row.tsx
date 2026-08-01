import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ExpandedSkillDetails } from '@/modules/skills/components/ExpandedSkillDetails';
import { SkillItemDetailsActions } from '@/modules/skills/components/skill-list/skill-item/actions';
import { useSkillItem } from '@/modules/skills/components/skill-list/skill-item/context';
import {
  SkillItemActions,
  SkillItemBody,
  SkillItemIdentity,
  SkillItemMain,
  SkillItemRail,
  SkillItemRoot
} from '@/modules/skills/components/skill-list/skill-item/primitives';

type RunnerCardSkillRowProps = {
  dismissable: boolean;
};

function RunnerCardSkillDetails() {
  const { skill, skillId, distanceFactor, valueScalingContext } = useSkillItem();

  return (
    <ExpandedSkillDetails
      id={skillId}
      skill={skill}
      distanceFactor={distanceFactor}
      valueScalingContext={valueScalingContext}
      showIdentity={false}
      className="rounded-none border-0 border-t bg-muted/20"
    />
  );
}

export function RunnerCardSkillRow(props: Readonly<RunnerCardSkillRowProps>) {
  const { dismissable } = props;

  return (
    <Collapsible>
      <SkillItemRoot className="overflow-hidden">
        <SkillItemRail />
        <SkillItemBody className="flex-col">
          <SkillItemMain className="p-1 pl-2">
            <SkillItemIdentity labelProps={{ className: 'text-xs font-medium' }} />
            <SkillItemActions>
              <CollapsibleTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-lg"
                    type="button"
                    aria-label="Toggle skill details"
                    title="Show skill details"
                    className="group"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <ChevronDown className="transition-transform duration-200 ease-out group-data-[panel-open]:rotate-180 motion-reduce:transition-none" />
                  </Button>
                }
              />
              <SkillItemDetailsActions dismissable={dismissable} />
            </SkillItemActions>
          </SkillItemMain>

          <CollapsibleContent className="h-[var(--collapsible-panel-height)] overflow-hidden transition-[height,opacity] duration-200 ease-out data-[ending-style]:h-0 data-[ending-style]:opacity-0 data-[starting-style]:h-0 data-[starting-style]:opacity-0 motion-reduce:transition-none">
            <RunnerCardSkillDetails />
          </CollapsibleContent>
        </SkillItemBody>
      </SkillItemRoot>
    </Collapsible>
  );
}
