import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  CHAMPIONS_MEETING_REWARDS,
  CLUB_RANK_MONTHLY_CARATS,
  DAILY_CARAT_PACK_AVERAGE_MONTHLY_CARATS,
  DAILY_CARAT_PACK_FREE_CARATS_PER_DAY,
  LEAGUE_OF_HEROES_REWARDS,
  TEAM_TRIALS_WEEKLY_CARATS,
  TRAINING_PASS_MATURE_MONTHLY_CARATS
} from '@/modules/carat/model/income-tables';
import { InfoHint } from '@/modules/carat/components/info-hint';
import { monthlyRecurringCarats } from '@/modules/carat/model/income';
import {
  type CaratSettings,
  getActivePlan,
  setCaratSetting,
  useCaratStore
} from '@/store/carat.store';

const teamTrialsOptions = Object.entries(TEAM_TRIALS_WEEKLY_CARATS).map(([value, carats]) => ({
  value,
  label: value.replace('class-', 'Class '),
  suffix: `${carats}/wk`
}));

const clubRankOptions = Object.entries(CLUB_RANK_MONTHLY_CARATS).map(([value, carats]) => ({
  value,
  label: value.toUpperCase(),
  suffix: `${carats.toLocaleString()}/mo`
}));

const formatRewardOption = ([value, reward]: [string, { carats: number; tickets: number }]) => ({
  value,
  label: value
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' '),
  suffix:
    reward.carats === 0 && reward.tickets === 0
      ? 'No rewards'
      : `${reward.carats.toLocaleString()} + ${reward.tickets} tickets`
});

const cmOptions = Object.entries(CHAMPIONS_MEETING_REWARDS).map(formatRewardOption);

const lohOptions = Object.entries(LEAGUE_OF_HEROES_REWARDS).map(formatRewardOption);

type NumberSettingKey = {
  [K in keyof CaratSettings]: CaratSettings[K] extends number ? K : never;
}[keyof CaratSettings];

function NumberField(props: {
  label: string;
  settingKey: NumberSettingKey;
  helper?: string;
  hint?: ReactNode;
}) {
  const { label, settingKey, helper, hint } = props;
  const value = useCaratStore((state) => getActivePlan(state).settings[settingKey]);

  return (
    <label className="grid gap-1.5 text-sm">
      <span className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          {label}
          {hint}
        </span>
        {helper ? <span className="text-[11px] text-muted-foreground">{helper}</span> : null}
      </span>
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        value={value}
        onChange={(event) =>
          setCaratSetting(settingKey, Math.max(0, Number(event.target.value) || 0))
        }
        className="text-right tabular-nums"
      />
    </label>
  );
}

function SelectField(props: {
  label: string;
  value: string;
  options: { value: string; label: string; suffix: string }[];
  onValueChange: (value: string) => void;
}) {
  const { label, value, options, onValueChange } = props;

  return (
    <label className="grid gap-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={(nextValue) => nextValue && onValueChange(nextValue)}>
        <SelectTrigger className="w-full">
          <SelectValue>
            {(selected: string) =>
              options.find((option) => option.value === selected)?.label ?? selected
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <span className="flex w-full justify-between gap-4">
                <span>{option.label}</span>
                <span className="text-muted-foreground">{option.suffix}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function Section(props: {
  title: string;
  defaultOpen?: boolean;
  emphasis?: boolean;
  children: ReactNode;
}) {
  const { title, defaultOpen = false, emphasis, children } = props;

  return (
    <Collapsible defaultOpen={defaultOpen} className="border-b">
      <CollapsibleTrigger
        className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold ${emphasis ? 'text-primary' : ''}`}
      >
        {title}
        <ChevronDown className="size-4 text-muted-foreground transition-transform data-[panel-open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 px-4 pb-4">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function SwitchRow(props: {
  label: string;
  checked: boolean;
  helper: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  const { label, checked, helper, onCheckedChange } = props;

  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <div>
        <div className="font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{helper}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

/** The income settings groups and glossary, hosted by the Income group of the plan assumptions band. */
export function IncomeSettingsSections() {
  const settings = useCaratStore((state) => getActivePlan(state).settings);
  const now = new Date();
  const monthly = monthlyRecurringCarats(settings, now);
  const withoutTrainingPass = monthlyRecurringCarats({ ...settings, trainingPass: 'none' }, now);
  const trainingPassOptions = Object.keys(TRAINING_PASS_MATURE_MONTHLY_CARATS).map((value) => {
    const trainingPass = value as CaratSettings['trainingPass'];
    const withTrainingPass = monthlyRecurringCarats({ ...settings, trainingPass }, now);
    return {
      value,
      label: value.charAt(0).toUpperCase() + value.slice(1),
      suffix: `${Math.round(withTrainingPass.carats - withoutTrainingPass.carats).toLocaleString()}/mo`
    };
  });

  return (
    <div data-tutorial="carat-settings" className="overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3 text-sm font-bold">
        <span className="inline-flex items-center gap-1">
          Income & Settings
          <InfoHint label="What are carats?" title="Carats">
            Carats are the main currency used for gacha pulls. One pull costs 150 carats.
          </InfoHint>
        </span>
        <span className="text-xs font-normal text-muted-foreground">Global server</span>
      </div>

      <Section title="Competitive">
        <SelectField
          label="Expected CM placement"
          value={settings.cmPlacement}
          options={cmOptions}
          onValueChange={(value) => setCaratSetting('cmPlacement', value)}
        />
        <SelectField
          label="Expected League of Heroes rank"
          value={settings.lohRank}
          options={lohOptions}
          onValueChange={(value) => setCaratSetting('lohRank', value)}
        />
      </Section>

      <Section title="Passes & Packs">
        <SwitchRow
          label="Daily Carat Pack"
          checked={settings.dailyCaratPack}
          helper={`+${DAILY_CARAT_PACK_FREE_CARATS_PER_DAY}/day (≈${Math.round(DAILY_CARAT_PACK_AVERAGE_MONTHLY_CARATS).toLocaleString()}/mo)`}
          onCheckedChange={(checked) => setCaratSetting('dailyCaratPack', checked)}
        />
        <SelectField
          label="Training Pass"
          value={settings.trainingPass}
          options={trainingPassOptions}
          onValueChange={(value) =>
            setCaratSetting('trainingPass', value as CaratSettings['trainingPass'])
          }
        />
        <SwitchRow
          label="Track paid carats"
          checked={settings.trackPaidCarats}
          helper="For paid selector planning later"
          onCheckedChange={(checked) => setCaratSetting('trackPaidCarats', checked)}
        />
      </Section>

      <Section title="Recurring Income" emphasis defaultOpen>
        <SelectField
          label="Team Trials class"
          value={settings.teamTrialsClass}
          options={teamTrialsOptions}
          onValueChange={(value) => setCaratSetting('teamTrialsClass', value)}
        />
        <SelectField
          label="Club rank"
          value={settings.clubRank}
          options={clubRankOptions}
          onValueChange={(value) => setCaratSetting('clubRank', value)}
        />
        <div className="grid gap-1.5 text-sm">
          <span className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              Monthly carats
              <InfoHint label="Monthly carats help" title="Monthly carats">
                Calculated from your Team Trials class, Club rank, and Passes &amp; Packs.
                Competitive (CM / League of Heroes) rewards are added per event on the timeline.
              </InfoHint>
            </span>
            <span className="text-[11px] text-muted-foreground">auto · from tables</span>
          </span>
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-right font-mono tabular-nums">
            {Math.round(monthly.carats).toLocaleString()}
          </div>
        </div>
        <div className="grid gap-1.5 text-sm">
          <span className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              Monthly tickets
              <InfoHint label="Monthly tickets help" title="Monthly tickets">
                Recurring pull tickets per month: a flat baseline plus your Training Pass, counted
                separately for Uma and Support. Champion&apos;s Meeting and League of Heroes tickets
                are added per event on the timeline.
              </InfoHint>
            </span>
            <span className="text-[11px] text-muted-foreground">auto · from tables</span>
          </span>
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-right font-mono tabular-nums">
            {monthly.umaTickets.toLocaleString()} Uma · {monthly.supportTickets.toLocaleString()}{' '}
            Support
          </div>
        </div>
      </Section>

      <Collapsible>
        <CollapsibleTrigger className="flex w-full items-center justify-between border-t px-4 py-3 text-left text-sm font-semibold text-primary">
          What do these terms mean?
          <ChevronDown className="size-4 text-muted-foreground transition-transform data-[panel-open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 px-4 pb-4 text-xs leading-5 text-muted-foreground">
          <p>
            <strong className="text-foreground">Pull:</strong> one gacha roll. It costs 150 carats
            or one matching ticket.
          </p>
          <p>
            <strong className="text-foreground">Spark / pity:</strong> 200 pulls lets you exchange
            for one guaranteed pickup copy.
          </p>
          <p>
            <strong className="text-foreground">LB / MLB:</strong> limit breaks from duplicate
            copies. MLB usually means five total copies.
          </p>
          <p>
            <strong className="text-foreground">Selector:</strong> a paid ticket or pack that lets
            you choose a target from a fixed roster.
          </p>
          <p>
            <strong className="text-foreground">Step-up:</strong> a paid banner with fixed steps and
            special guaranteed slots.
          </p>
          <p>
            <strong className="text-foreground">Confidence badges:</strong> confirmed dates are
            official; estimated/predicted dates come from timeline spacing.
          </p>
        </CollapsibleContent>
      </Collapsible>

      <div className="flex justify-between border-t px-4 py-3 text-xs text-muted-foreground">
        <span>Pull cost: 150 carats/pull</span>
        <span>Spark/pity: 200 pulls</span>
      </div>
    </div>
  );
}
