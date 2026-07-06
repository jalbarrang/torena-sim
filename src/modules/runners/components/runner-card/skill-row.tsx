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

  return (
    <SkillItemRoot>
      <SkillItemRail />
      <SkillItemBody className="flex-col">
        <SkillItemMain className="p-1 px-1">
          <SkillItemIdentity labelProps={{ className: 'text-xs' }} />
        </SkillItemMain>

        {/* Own row so the stepper never competes for width with the cost +
            actions in the dense 2-column runner panel (that clipped the minus
            button). `empty:hidden` collapses the row when the stepper renders
            null (unique/obtained skills, or SP cost disabled). */}
        <div className="flex px-1 pb-1 empty:hidden">
          <SkillItemHintStepper />
        </div>

        <SkillItemActions className="justify-end bg-card">
          <SkillItemCostAction layout="inline" />
          <SkillItemDetailsActions dismissable={dismissable} />
        </SkillItemActions>
      </SkillItemBody>
    </SkillItemRoot>
  );
}
