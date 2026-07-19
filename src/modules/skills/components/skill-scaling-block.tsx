import type {
  ValueScalingDisplayModel,
  ValueScalingRow
} from '@/lib/uma-domain/skills/value-scaling/descriptor.types';
import i18n from '@/i18n';
import { formatEffect } from './formatters';

type SkillScalingBlockProps = {
  model: ValueScalingDisplayModel;
};

export function roundScalingDisplayValue(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatEffectValue(effectType: number, value: number) {
  const formatter = formatEffect[effectType as keyof typeof formatEffect];
  const roundedValue = roundScalingDisplayValue(value);
  return formatter ? formatter(roundedValue) : roundedValue.toString();
}

function effectLabel(effectType: number, value: number): string {
  return effectType === 9 && value < 0 ? 'HP Drain' : i18n.t(`skilleffecttypes.${effectType}`);
}

function ScalingRow(props: { row: ValueScalingRow }) {
  const { row } = props;

  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 font-mono text-[11px]">
      <span className="font-sans text-muted-foreground">
        {effectLabel(row.effectType, row.result)}
      </span>
      <span>
        {formatEffectValue(row.effectType, row.base)} × {row.multiplier}× ={' '}
        <span className="font-medium text-foreground">
          {formatEffectValue(row.effectType, row.result)}
        </span>
      </span>
    </div>
  );
}

export function SkillScalingBlock(props: Readonly<SkillScalingBlockProps>) {
  const { model } = props;

  return (
    <section
      aria-label="Special scaling"
      className="mt-2 rounded-md border border-border bg-muted/30 p-2 text-xs"
      data-resolution={model.resolution}
    >
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Special scaling
          </div>
          <div className="font-medium">{model.header}</div>
        </div>
        {model.trailing && (
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
            {model.trailing}
          </span>
        )}
      </div>

      {model.tiers && (
        <div className="mb-1.5 grid grid-flow-col auto-cols-fr overflow-hidden rounded-sm border border-border">
          {model.tiers.map((tier, index) => {
            const isActive = index === model.activeTierIndex;

            return (
              <div
                key={tier.label}
                aria-current={isActive ? 'true' : undefined}
                className="min-w-0 border-l border-border px-1 py-1 text-center first:border-l-0"
                data-active={isActive || undefined}
              >
                <div className={isActive ? 'font-medium text-foreground' : 'text-muted-foreground'}>
                  {tier.label}
                </div>
                <div
                  className={isActive ? 'font-mono font-medium' : 'font-mono text-muted-foreground'}
                >
                  {tier.multiplier}×
                </div>
              </div>
            );
          })}
        </div>
      )}

      {model.rows && (
        <div className="space-y-1 border-t border-border pt-1.5">
          {model.rows.map((row) => (
            <ScalingRow key={`${row.effectType}-${row.base}`} row={row} />
          ))}
        </div>
      )}

      {model.notes && (
        <div className="mt-1.5 space-y-0.5 text-[11px] leading-snug text-muted-foreground">
          {model.notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>
      )}
    </section>
  );
}
