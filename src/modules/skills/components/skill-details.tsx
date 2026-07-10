import { Code } from 'lucide-react';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import i18n from '@/i18n';
import type { SkillAlternative } from '@/lib/uma-domain/skills/skill.types';
import { describeRecoveryEffect } from '@/lib/uma-domain/skills/recovery-effect-utils';
import type { SkillEntry } from '@/modules/data/services/SkillService';
import { formatEffect, FormatParser } from './formatters';
import { HumanReadableParser } from './human-readable-formatter';

type SkillDetailsVariant = 'default' | 'compact' | 'plain';

type SkillDetailsProps = {
  skill: SkillEntry;
  distanceFactor?: number;
  variant?: SkillDetailsVariant;
};

type SkillAlternativeDetailsProps = {
  alternative: SkillAlternative;
  title?: string;
  distanceFactor?: number;
  variant?: SkillDetailsVariant;
};

function getAlternativeKey(alternative: SkillAlternative) {
  return `${alternative.precondition ?? ''}-${alternative.condition}-${alternative.baseDuration}-${alternative.cooldownTime ?? ''}`;
}

function SkillRawCondition(props: { label: string; value: string }) {
  const { label, value } = props;

  return (
    <Collapsible>
      <CollapsibleTrigger className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground">
        <Code className="size-3" />
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-1 overflow-x-auto rounded border border-foreground/10 bg-foreground/5 p-2 font-mono text-xs">
          {FormatParser.parse(value).format()}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

function SkillDetailSection(props: { title: string; children: React.ReactNode }) {
  const { title, children } = props;

  return (
    <section className="space-y-1">
      <div className="text-xs font-medium text-muted-foreground">{title}</div>

      {children}
    </section>
  );
}

function SkillEffects(props: { alternative: SkillAlternative }) {
  const { alternative } = props;

  return (
    <div className="flex flex-col gap-1">
      {alternative.effects.map((effect, effectIndex) => {
        const modifier = effect.modifier / 10000;
        const effectType = formatEffect[effect.type as keyof typeof formatEffect];
        const effectValue =
          describeRecoveryEffect({ ...effect, modifier }) ??
          (effectType ? effectType(modifier) : modifier);
        const effectLabel =
          effect.type === 9 && modifier < 0
            ? 'HP Drain'
            : i18n.t(`skilleffecttypes.${effect.type}`);
        const effectKey = `${effectIndex}-${effect.type}-${effect.target}-${effect.modifier}`;

        return (
          <div key={effectKey} className="flex items-center gap-1 text-xs">
            <span className="text-muted-foreground">{effectLabel}</span>
            <span className="text-right font-medium">{effectValue}</span>
          </div>
        );
      })}
    </div>
  );
}

function SkillTiming(props: { alternative: SkillAlternative; distanceFactor?: number }) {
  const { alternative, distanceFactor } = props;
  const hasBaseDuration = alternative.baseDuration > 0;
  const hasCooldown = !!alternative.cooldownTime && alternative.cooldownTime > 0;

  if (!hasBaseDuration && !hasCooldown) {
    return null;
  }

  return (
    <SkillDetailSection title="Timing">
      <div className="space-y-1 text-xs">
        {hasBaseDuration ? (
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">{i18n.t('skilldetails.baseduration')}</span>
            <span className="font-medium">
              {i18n.t('skilldetails.seconds', { n: alternative.baseDuration / 10000 })}
            </span>
          </div>
        ) : null}

        {hasBaseDuration && !!distanceFactor ? (
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">
              {i18n.t('skilldetails.effectiveduration', { distance: distanceFactor })}
            </span>
            <span className="font-medium">
              {i18n.t('skilldetails.seconds', {
                n: +((alternative.baseDuration / 10000) * (distanceFactor / 1000)).toFixed(2)
              })}
            </span>
          </div>
        ) : null}

        {hasCooldown ? (
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">Cooldown</span>
            <span className="font-medium">
              {i18n.t('skilldetails.seconds', { n: (alternative.cooldownTime ?? 0) / 10000 })}
            </span>
          </div>
        ) : null}
      </div>
    </SkillDetailSection>
  );
}

function SkillAlternativeDetails(props: SkillAlternativeDetailsProps) {
  const { alternative, title, distanceFactor, variant = 'default' } = props;
  const precondition = alternative.precondition ?? '';
  const compact = variant === 'compact' || variant === 'plain';

  return (
    <div
      className={
        variant === 'plain'
          ? 'grid min-w-0 gap-2 text-xs'
          : 'grid min-w-0 gap-2 rounded-lg border bg-background p-3 text-xs'
      }
    >
      {title && <div className="text-sm font-medium">{title}</div>}

      <div className={compact ? 'grid gap-2 md:grid-cols-2' : 'grid gap-2 md:grid-cols-3'}>
        <div className="flex flex-col">
          {precondition.length > 0 && (
            <SkillDetailSection title={i18n.t('skilldetails.preconditions')}>
              <div className="min-w-0 pl-1">{HumanReadableParser.parse(precondition).format()}</div>
              <SkillRawCondition label="Raw" value={precondition} />
            </SkillDetailSection>
          )}

          {alternative.condition.length > 0 && (
            <SkillDetailSection title={i18n.t('skilldetails.conditions')}>
              <div className="min-w-0 pl-1">
                {HumanReadableParser.parse(alternative.condition).format()}
              </div>
              <SkillRawCondition label="Raw" value={alternative.condition} />
            </SkillDetailSection>
          )}
        </div>

        {compact ? (
          <div className="grid content-start gap-2">
            <SkillDetailSection title={i18n.t('skilldetails.effects')}>
              <SkillEffects alternative={alternative} />
            </SkillDetailSection>
            <SkillTiming alternative={alternative} distanceFactor={distanceFactor} />
          </div>
        ) : (
          <>
            <SkillDetailSection title={i18n.t('skilldetails.effects')}>
              <SkillEffects alternative={alternative} />
            </SkillDetailSection>

            <SkillTiming alternative={alternative} distanceFactor={distanceFactor} />
          </>
        )}
      </div>
    </div>
  );
}

export function SkillDetails(props: SkillDetailsProps) {
  const { skill, distanceFactor, variant = 'default' } = props;

  if (skill.alternatives.length === 1) {
    const alternative = skill.alternatives[0];

    return (
      <SkillAlternativeDetails
        alternative={alternative}
        distanceFactor={distanceFactor}
        variant={variant}
      />
    );
  }

  return (
    <>
      <div className="md:hidden">
        <Tabs defaultValue={0}>
          <TabsList className="w-full">
            {skill.alternatives.map((alternative, index) => (
              <TabsTrigger key={getAlternativeKey(alternative)} value={index}>
                Alt {index + 1}
              </TabsTrigger>
            ))}
          </TabsList>

          {skill.alternatives.map((alternative, index) => (
            <TabsContent key={getAlternativeKey(alternative)} value={index}>
              <SkillAlternativeDetails
                alternative={alternative}
                distanceFactor={distanceFactor}
                variant={variant}
              />
            </TabsContent>
          ))}
        </Tabs>
      </div>

      <div className="hidden min-w-0 gap-2 md:flex md:flex-col">
        {skill.alternatives.map((alternative, index) => (
          <SkillAlternativeDetails
            key={getAlternativeKey(alternative)}
            alternative={alternative}
            title={`Alternative ${index + 1}`}
            distanceFactor={distanceFactor}
            variant={variant}
          />
        ))}
      </div>
    </>
  );
}
