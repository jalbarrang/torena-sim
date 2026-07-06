import {
  SkillItemBody,
  SkillItemIdentity,
  SkillItemMain,
  SkillItemRoot,
  SkillItemRail,
  SkillItemActions
} from '@/modules/skills/components/skill-list/skill-item/primitives';
import {
  SkillItemCostAction,
  SkillItemDetailsActions
} from '@/modules/skills/components/skill-list/skill-item/actions';
import { SkillItemHintStepper } from '@/modules/skills/components/skill-list/skill-item/hint-stepper';

type RunnerCardSkillRowProps = {
  dismissable: boolean;
  // NOTE: `inline` is currently a no-op — the original implementation never
  // returned the inline variant, so all rows render the stacked layout below.
  // Preserved as-is during extraction; see follow-up to decide intended behavior.
  inline: boolean;
};

export function RunnerCardSkillRow(props: Readonly<RunnerCardSkillRowProps>) {
  const { dismissable } = props;

  // Mirrors the planner candidate card composition: identity + detail actions
  // on the top row, hint stepper + cost sharing the bottom row on one axis.
  // `empty:hidden` collapses the bottom row when both render null (unique
  // skills, or SP cost editing disabled), leaving a compact single-row card.
  return (
    <SkillItemRoot>
      <SkillItemRail />
      <SkillItemBody className="flex-col">
        <SkillItemMain className="p-1 px-1">
          <SkillItemIdentity labelProps={{ className: 'text-xs' }} />
          <SkillItemActions>
            <SkillItemDetailsActions dismissable={dismissable} />
          </SkillItemActions>
        </SkillItemMain>

        <div className="flex items-center gap-2 px-1 pb-1 empty:hidden">
          <SkillItemHintStepper />
          <SkillItemCostAction layout="inline" className="ml-auto" />
        </div>
      </SkillItemBody>
    </SkillItemRoot>
  );
}
