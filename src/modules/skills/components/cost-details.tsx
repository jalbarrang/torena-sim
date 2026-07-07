import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { SkillIcon } from './skill-list/skill-item/SkillIcon';
import { useSkillItem } from './skill-list/skill-item/context';
import i18n from '@/i18n';
import { memo, useMemo } from 'react';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { HintLevelStepper } from './skill-list/skill-item/hint-stepper';
import type { HintLevel } from '@/modules/skill-planner/types';
import { calculateSkillCost } from '@/modules/skill-planner/cost-calculator';
import {
  getRelatedSkillIds,
  getRepresentativePrerequisiteIds,
  isSkillCoveredByOwnedFamily
} from '@/modules/skill-planner/skill-family';
import { skillsService } from '@/modules/data/services/SkillService';
import { buildSkillCostSummary } from '@/modules/skills/skill-cost-summary';

type PrereqItemProps = {
  prereqId: string;
};

const PrereqItem = memo((props: PrereqItemProps) => {
  const { prereqId } = props;
  const { runnerId, hasFastLearner, getSkillMeta, onHintLevelChange, onBoughtChange } =
    useSkillItem();

  const prereqSkill = useMemo(() => {
    const skill = skillsService.getById(prereqId);
    if (!skill) throw new Error(`Prereq skill not found: ${prereqId}`);
    return skill;
  }, [prereqId]);
  const meta = useMemo(() => getSkillMeta(prereqId), [getSkillMeta, prereqId]);
  const hintLevel = meta.hintLevel as HintLevel;
  const bought = meta.bought ?? false;

  const prereqNetCost = useMemo(
    () => (bought ? 0 : calculateSkillCost(prereqId, hintLevel as HintLevel, hasFastLearner)),
    [bought, prereqId, hintLevel, hasFastLearner]
  );

  const boughtCheckboxId = `${runnerId ?? 'runner'}-${prereqId}-bought`;

  return (
    <div className="border rounded-sm p-2 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <SkillIcon iconId={prereqSkill.iconId} />
          <div className="min-w-0">
            <div className="font-medium leading-tight truncate">{prereqSkill.name}</div>
            <div className="text-[11px] text-muted-foreground">
              {i18n.t('skilldetails.id')}
              {prereqId}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Checkbox
            id={boughtCheckboxId}
            checked={bought}
            onCheckedChange={(checked) => onBoughtChange?.(prereqId, checked === true)}
            disabled={!onBoughtChange}
          />
          <Label htmlFor={boughtCheckboxId} className="text-xs">
            Bought
          </Label>
        </div>
      </div>

      {!bought && (
        <div className="grid grid-cols-[1fr_auto] gap-y-1 gap-x-3 items-center">
          <span className="text-muted-foreground">Base Cost</span>
          <span className="font-medium">{prereqSkill.baseCost} SP</span>

          <span className="text-muted-foreground">Hint Lvl</span>
          <HintLevelStepper
            level={hintLevel}
            onChange={(level) => onHintLevelChange?.(prereqId, level)}
            disabled={!onHintLevelChange}
          />

          <span className="text-muted-foreground">Net Cost</span>
          <span className="font-semibold">{prereqNetCost} SP</span>
        </div>
      )}
    </div>
  );
});

/**
 * Cost breakdown popover content. Reads all state and callbacks from SkillItemContext
 * so it works identically in compare mode and the skill planner.
 */
export const SkillCostDetails = () => {
  const {
    skill,
    skillId,
    normalizedSkillId,
    hasFastLearner,
    getSkillMeta,
    onHintLevelChange,
    onBoughtChange,
    costSummary
  } = useSkillItem();

  const selfMeta = useMemo(() => getSkillMeta(skillId), [getSkillMeta, skillId]);
  const hintLevel = selfMeta.hintLevel as HintLevel;

  const representativePrereqIds = useMemo(() => {
    const boughtFamilySkillIds = getRelatedSkillIds(normalizedSkillId).filter(
      (relatedSkillId) => getSkillMeta(relatedSkillId).bought === true
    );

    return getRepresentativePrerequisiteIds(normalizedSkillId).filter(
      (prereqId) => !isSkillCoveredByOwnedFamily(prereqId, boughtFamilySkillIds)
    );
  }, [getSkillMeta, normalizedSkillId]);
  const hasPrerequisites = representativePrereqIds.length > 0;

  const netCost = useMemo(
    () => calculateSkillCost(normalizedSkillId, hintLevel, hasFastLearner),
    [hasFastLearner, hintLevel, normalizedSkillId]
  );

  const resolvedCostSummary = useMemo(() => {
    if (costSummary) {
      return costSummary;
    }

    return buildSkillCostSummary({
      skillId,
      hasFastLearner,
      getSkillMeta
    });
  }, [costSummary, skillId, hasFastLearner, getSkillMeta]);

  const isObtained = resolvedCostSummary.isObtained;
  const obtainedCheckboxId = `cost-details-${skillId}-obtained`;

  return (
    <div className={cn('bg-background border-2 rounded-b-sm flex flex-col')}>
      <div className="text-sm p-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Cost details</div>
          {onBoughtChange && (
            <div className="flex items-center gap-1.5">
              <Checkbox
                id={obtainedCheckboxId}
                checked={isObtained}
                onCheckedChange={(checked) => onBoughtChange(skillId, checked === true)}
              />
              <Label htmlFor={obtainedCheckboxId} className="text-xs cursor-pointer font-normal">
                Obtained
              </Label>
            </div>
          )}
        </div>
      </div>

      <Separator />

      <div className="p-2 text-xs">
        {isObtained ? (
          <div className="text-center text-muted-foreground py-2">
            Skill already obtained, no cost.
          </div>
        ) : !hasPrerequisites ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <SkillIcon iconId={skill.iconId} />
              <div className="min-w-0">
                <div className="font-medium leading-tight truncate">{skill.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {i18n.t('skilldetails.id')}
                  {skillId}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Base Cost</span>
              <span className="font-medium">{skill.baseCost} SP</span>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Hint Lvl</span>
              <HintLevelStepper
                level={hintLevel}
                onChange={(level) => onHintLevelChange?.(skillId, level)}
                disabled={!onHintLevelChange}
              />
            </div>

            <div className="grid grid-cols-[1fr_auto] gap-y-1 gap-x-3 items-center border-t pt-2">
              <span className="text-muted-foreground">Aggregate Base</span>
              <span className="font-medium">{resolvedCostSummary.baseTotal} SP</span>

              <span className="text-muted-foreground">Aggregate Net</span>
              <span className="text-sm font-semibold">{resolvedCostSummary.netTotal} SP</span>

              <span className="text-muted-foreground">Discount</span>
              <span className="font-medium">
                {resolvedCostSummary.exactDiscountPct.toFixed(1)}%
              </span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {representativePrereqIds.map((prereqId) => (
              <PrereqItem key={prereqId} prereqId={prereqId} />
            ))}

            <div className="border rounded-sm p-2 flex flex-col gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <SkillIcon iconId={skill.iconId} />
                <div className="min-w-0">
                  <div className="font-medium leading-tight truncate">{skill.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {i18n.t('skilldetails.id')}
                    {skillId}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-[1fr_auto] gap-y-1 gap-x-3 items-center">
                <span className="text-muted-foreground">Base Cost</span>
                <span className="font-medium">{skill.baseCost} SP</span>

                <span className="text-muted-foreground">Hint Lvl</span>
                <HintLevelStepper
                  level={hintLevel}
                  onChange={(level) => onHintLevelChange?.(skillId, level)}
                  disabled={!onHintLevelChange}
                />

                <span className="text-muted-foreground">Net Cost</span>
                <span className="font-semibold">{netCost} SP</span>
              </div>
            </div>

            <div className="grid grid-cols-[1fr_auto] gap-y-1 gap-x-3 items-center border-t pt-2">
              <span className="text-muted-foreground">Aggregate Base</span>
              <span className="font-medium">{resolvedCostSummary.baseTotal} SP</span>

              <span className="text-muted-foreground">Aggregate Net</span>
              <span className="font-semibold">{resolvedCostSummary.netTotal} SP</span>

              <span className="text-muted-foreground">Discount</span>
              <span className="font-medium">
                {resolvedCostSummary.exactDiscountPct.toFixed(1)}%
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
