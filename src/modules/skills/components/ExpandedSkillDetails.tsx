import type { SkillEntry } from '@/modules/data/services/SkillService';
import type { SkillAlternative } from '@/lib/uma-domain/skills/skill.types';
import { FormatParser, formatEffect } from '@/modules/skills/components/formatters';
import { HumanReadableParser } from '@/modules/skills/components/human-readable-formatter';
import { describeRecoveryEffect } from '@/lib/uma-domain/skills/recovery-effect-utils';
import { cn } from '@/lib/utils';
import i18n from '@/i18n';
import { Code } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { SkillIcon } from './skill-list/skill-item/SkillIcon';

type IAlternativeDetailsProps = {
  alternative: SkillAlternative;
  distanceFactor?: number;
};

function AlternativeDetails(props: Readonly<IAlternativeDetailsProps>) {
  const { alternative, distanceFactor } = props;
  const precondition = alternative.precondition ?? '';

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
          {alternative.effects.map((ef, effectIndex) => {
            const type = ef.type;
            const modifier = ef.modifier / 10000;
            const effectType = formatEffect[type as keyof typeof formatEffect];
            const effectValue =
              describeRecoveryEffect({ ...ef, modifier }) ??
              (effectType ? effectType(modifier) : modifier);
            const effectLabel =
              type === 9 && modifier < 0 ? 'HP Drain' : i18n.t(`skilleffecttypes.${type}`);
            const effectKey = `${effectIndex}-${ef.type}-${ef.target}-${ef.modifier}`;

            return (
              <div key={effectKey} className="flex items-center gap-1 py-px">
                <span className="shrink-0 size-1 rounded-full bg-foreground/40"></span>
                <span>
                  {effectLabel}: {effectValue}
                </span>
              </div>
            );
          })}
        </div>
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
  className?: string;
};

export function ExpandedSkillDetails(props: ExpandedSkillDetailsProps) {
  const { skill: skillData } = props;

  return (
    <div className={cn('bg-background border-2 rounded-b-sm flex flex-col')}>
      <div className="text-sm p-2">
        <div className="flex flex-col gap-1 mb-1">
          <div className="flex items-center gap-2">
            <SkillIcon iconId={skillData.iconId} />
            <div className="text-sm font-medium">{skillData.name}</div>
          </div>

          <div className="text-xs text-muted-foreground">
            {i18n.t('skilldetails.id')}
            {props.id}
          </div>
        </div>

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
                    distanceFactor={props.distanceFactor}
                  />
                </TabsContent>
              );
            })}
          </Tabs>
        ) : (
          <AlternativeDetails
            alternative={skillData.alternatives[0]}
            distanceFactor={props.distanceFactor}
          />
        )}
      </div>
    </div>
  );
}
