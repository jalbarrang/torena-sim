import type { SkillEntry } from '@/modules/data/services/SkillService';
import type { SkillAlternative } from '@/lib/uma-domain/skills/skill.types';
import type { ValueScalingDisplayContext } from '@/lib/uma-domain/skills/value-scaling/descriptor.types';
import { FormatParser, formatEffect } from '@/modules/skills/components/formatters';
import { HumanReadableParser } from '@/modules/skills/components/human-readable-formatter';
import {
  buildValueScalingDisplay,
  describeValueScaling
} from '@/lib/uma-domain/skills/value-scaling/registry';
import { cn } from '@/lib/utils';
import i18n from '@/i18n';
import { Code } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { SkillIcon } from './skill-list/skill-item/SkillIcon';
import { SkillScalingBlock } from './skill-scaling-block';

type IAlternativeDetailsProps = {
  alternative: SkillAlternative;
  distanceFactor?: number;
  valueScalingContext?: ValueScalingDisplayContext;
};

function AlternativeDetails(props: Readonly<IAlternativeDetailsProps>) {
  const { alternative, distanceFactor, valueScalingContext } = props;
  const precondition = alternative.precondition ?? '';
  const effects = alternative.effects.map((effect) => ({
    ...effect,
    modifier: effect.modifier / 10000
  }));
  const scalingModels = buildValueScalingDisplay(effects, valueScalingContext ?? {});
  const structuredScalingUsages = new Set(scalingModels.map((model) => model.usage));

  return (
    <div className="flex flex-col text-xs gap-2">
      {precondition.length > 0 && (
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
            {i18n.t('skilldetails.preconditions')}
          </div>
          <div className="pl-1">{HumanReadableParser.parse(precondition).format()}</div>

          <Collapsible>
            <CollapsibleTrigger className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer mt-1">
              <Code className="size-3" />
              Raw
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="mt-1 p-2 rounded bg-foreground/5 border border-foreground/10 text-xs font-mono overflow-x-auto">
                {FormatParser.parse(precondition).format()}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}

      {alternative.condition.length > 0 && (
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
            {i18n.t('skilldetails.conditions')}
          </div>
          <div className="pl-1">{HumanReadableParser.parse(alternative.condition).format()}</div>
          <Collapsible>
            <CollapsibleTrigger className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer mt-1">
              <Code className="size-3" />
              Raw
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="mt-1 p-2 rounded bg-foreground/5 border border-foreground/10 text-xs font-mono overflow-x-auto">
                {FormatParser.parse(alternative.condition).format()}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}

      <div>
        {i18n.t('skilldetails.effects')}

        <div>
          {effects.map((ef, effectIndex) => {
            const type = ef.type;
            const modifier = ef.modifier;
            const effectType = formatEffect[type as keyof typeof formatEffect];
            const hasStructuredScaling = structuredScalingUsages.has(ef.valueUsage ?? 1);
            const effectValue =
              (hasStructuredScaling ? null : describeValueScaling(ef)) ??
              (effectType ? effectType(modifier) : modifier);
            const effectLabel =
              type === 9 && modifier < 0 ? 'HP Drain' : i18n.t(`skilleffecttypes.${type}`);
            const effectKey = `${effectIndex}-${ef.type}-${ef.target}-${ef.modifier}`;

            return (
              <div key={effectKey}>
                <div className="flex items-center gap-1 py-px">
                  <span className="shrink-0 size-1 rounded-full bg-foreground/40"></span>
                  <span>
                    {effectLabel}: {effectValue}
                  </span>
                  {hasStructuredScaling && (
                    <span className="rounded-full border border-border px-1.5 py-px text-[10px] font-medium text-muted-foreground">
                      scaled
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {scalingModels.map((model) => (
          <SkillScalingBlock key={model.usage} model={model} />
        ))}
      </div>

      {alternative.baseDuration > 0 && (
        <div>
          <div>
            {i18n.t('skilldetails.baseduration')}{' '}
            {i18n.t('skilldetails.seconds', {
              n: alternative.baseDuration / 10000
            })}
          </div>

          {!!distanceFactor && (
            <div>
              {i18n.t('skilldetails.effectiveduration', {
                distance: distanceFactor
              })}{' '}
              {i18n.t('skilldetails.seconds', {
                n: +((alternative.baseDuration / 10000) * (distanceFactor / 1000)).toFixed(2)
              })}
            </div>
          )}
        </div>
      )}

      {alternative.cooldownTime ? (
        <div>
          Cooldown:{' '}
          {i18n.t('skilldetails.seconds', {
            n: alternative.cooldownTime / 10000
          })}
        </div>
      ) : null}
    </div>
  );
}

type ExpandedSkillDetailsProps = {
  id: string;
  skill: SkillEntry;
  distanceFactor?: number;
  valueScalingContext?: ValueScalingDisplayContext;
  className?: string;
  showIdentity?: boolean;
};

export function ExpandedSkillDetails(props: ExpandedSkillDetailsProps) {
  const {
    id,
    skill: skillData,
    distanceFactor,
    valueScalingContext,
    className,
    showIdentity = true
  } = props;

  return (
    <div className={cn('flex flex-col rounded-b-sm border-2 bg-background', className)}>
      <div className="p-2 text-sm">
        {showIdentity && (
          <div className="mb-1 flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <SkillIcon iconId={skillData.iconId} />
              <div className="text-sm font-medium">{skillData.name}</div>
            </div>

            <div className="text-xs text-muted-foreground">
              {i18n.t('skilldetails.id')}
              {id}
            </div>
          </div>
        )}

        {skillData.alternatives.length > 1 ? (
          <Tabs defaultValue={0}>
            <TabsList>
              {skillData.alternatives.map((alternative, index) => {
                const alternativeKey = `${alternative.precondition ?? ''}-${alternative.condition}-${alternative.baseDuration}`;

                return (
                  <TabsTrigger key={alternativeKey} value={index}>
                    Alt {index + 1}
                  </TabsTrigger>
                );
              })}
            </TabsList>

            {skillData.alternatives.map((alternative, index) => {
              const alternativeKey = `${alternative.precondition ?? ''}-${alternative.condition}-${alternative.baseDuration}`;

              return (
                <TabsContent key={alternativeKey} value={index}>
                  <AlternativeDetails
                    alternative={alternative}
                    distanceFactor={distanceFactor}
                    valueScalingContext={valueScalingContext}
                  />
                </TabsContent>
              );
            })}
          </Tabs>
        ) : (
          <AlternativeDetails
            alternative={skillData.alternatives[0]}
            distanceFactor={distanceFactor}
            valueScalingContext={valueScalingContext}
          />
        )}
      </div>
    </div>
  );
}
