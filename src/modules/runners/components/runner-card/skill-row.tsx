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

        <SkillItemActions className="justify-end bg-card">
          <SkillItemCostAction layout="inline" />
          <SkillItemDetailsActions dismissable={dismissable} />
        </SkillItemActions>
      </SkillItemBody>
    </SkillItemRoot>
  );
}
