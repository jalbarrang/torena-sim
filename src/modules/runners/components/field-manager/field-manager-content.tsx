import { Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  addRunner,
  removeRunner,
  setCompareRole,
  showRunner,
  useCompareRoles,
  useRunners,
  MAX_RUNNERS,
  MIN_RUNNERS,
  type CompareRole,
  type FieldRunner
} from '@/store/runners.store';
import {
  canUseVacuum,
  clampFieldSize,
  setCompareMode,
  setFieldSize,
  useCompareSettings,
  MAX_FIELD_SIZE,
  MIN_FIELD_SIZE,
  type CompareMode
} from '@/modules/simulation/stores/compare.store';
import { getUmaDisplayInfo, getUmaImageUrl } from '@/modules/runners/utils';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

export const COMPARE_A_COLOR = '#2a77c5';
export const COMPARE_B_COLOR = '#c52a2a';

const runnerDisplayName = (runner: FieldRunner): string => {
  if (!runner.outfitId) return 'New runner';
  return getUmaDisplayInfo(runner.outfitId)?.name ?? 'New runner';
};

type RunnerAvatarProps = {
  runner: FieldRunner;
  compareRole: CompareRole | null;
  className?: string;
};

export function RunnerAvatar(props: RunnerAvatarProps) {
  const { runner, compareRole, className } = props;

  return (
    <span
      className={cn(
        'relative inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full border-2',
        className
      )}
      style={{
        borderColor:
          compareRole === 'uma1'
            ? COMPARE_A_COLOR
            : compareRole === 'uma2'
              ? COMPARE_B_COLOR
              : 'transparent'
      }}
    >
      <img
        src={getUmaImageUrl(runner.outfitId, runner.randomMobId)}
        alt=""
        className="size-full object-cover"
        loading="lazy"
      />
    </span>
  );
}

type RoleRadioProps = {
  compareRole: CompareRole;
  active: boolean;
  runnerName: string;
  onSelect: () => void;
};

function RoleRadio(props: RoleRadioProps) {
  const { compareRole, active, runnerName, onSelect } = props;
  const color = compareRole === 'uma1' ? COMPARE_A_COLOR : COMPARE_B_COLOR;
  const label = compareRole === 'uma1' ? 'A' : 'B';

  return (
    <button
      type="button"
      aria-label={`Set ${runnerName} as Compare ${label}`}
      aria-pressed={active}
      onClick={onSelect}
      className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span
        className="inline-block size-[18px] rounded-full border-2 transition-colors"
        style={{
          borderColor: active ? color : 'var(--input)',
          backgroundColor: active ? color : 'transparent'
        }}
      />
    </button>
  );
}

type FieldManagerContentProps = {
  /** `null` = manage mode; a role = pick mode for that compare slot. */
  pickRole: CompareRole | null;
  onClose: () => void;
};

export function FieldManagerContent(props: FieldManagerContentProps) {
  const { pickRole, onClose } = props;

  const runners = useRunners();
  const { compareA, compareB } = useCompareRoles();
  const { compareMode, fieldSize } = useCompareSettings();

  const roleOf = (fieldId: string): CompareRole | null => {
    if (fieldId === compareA) return 'uma1';
    if (fieldId === compareB) return 'uma2';
    return null;
  };

  const handleEdit = (fieldId: string) => {
    showRunner(fieldId);
    onClose();
  };

  const handleAssign = (fieldId: string, role: CompareRole) => {
    setCompareRole(fieldId, role);
    showRunner(fieldId);
    if (pickRole) onClose();
  };

  const handleAdd = () => {
    const fieldId = addRunner();
    if (!fieldId) return;
    if (pickRole) {
      handleAssign(fieldId, pickRole);
      return;
    }
    showRunner(fieldId);
    toast.success('Runner added to field');
  };

  const handleRemove = (runner: FieldRunner) => {
    removeRunner(runner.fieldId);
  };

  const atMax = runners.length >= MAX_RUNNERS;
  const atMin = runners.length <= MIN_RUNNERS;
  const picking = pickRole !== null;
  const mobCount = Math.max(0, fieldSize - runners.length);

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex items-baseline justify-between px-1">
        <h3 className="text-sm font-semibold">
          {picking ? `Choose Compare ${pickRole === 'uma1' ? 'A' : 'B'}` : 'Race field'}
        </h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          {runners.length} / {MAX_RUNNERS}
        </span>
      </div>

      <p className="px-1 text-xs text-muted-foreground">
        {picking
          ? 'Tap a runner to put them in this compare slot.'
          : 'Tap A / B to set the compare pair. Tap a name to edit. Everyone races.'}
      </p>

      {!picking && (
        <div
          className="grid items-center gap-0.5 px-1 text-center text-[10px] font-semibold text-muted-foreground"
          style={{ gridTemplateColumns: 'minmax(0,1fr) 40px 40px 40px' }}
        >
          <span className="text-left">Runner</span>
          <span style={{ color: COMPARE_A_COLOR }}>A</span>
          <span style={{ color: COMPARE_B_COLOR }}>B</span>
          <span />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {runners.map((runner) => {
          const role = roleOf(runner.fieldId);
          const name = runnerDisplayName(runner);

          const identity = (
            <button
              type="button"
              onClick={() => (picking ? handleAssign(runner.fieldId, pickRole) : handleEdit(runner.fieldId))}
              className="flex min-w-0 cursor-pointer items-center gap-2.5 rounded-md py-1 text-left focus-visible:outline-2 focus-visible:outline-ring"
            >
              <RunnerAvatar runner={runner} compareRole={role} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{name}</span>
                <span className="block text-xs text-muted-foreground">{runner.strategy}</span>
              </span>
            </button>
          );

          if (picking) {
            return (
              <div
                key={runner.fieldId}
                className="flex items-center justify-between gap-2 rounded-md px-1 hover:bg-muted/50"
              >
                {identity}
                <span className="shrink-0 pr-1 text-xs text-muted-foreground">
                  {role === 'uma1' ? 'currently A' : role === 'uma2' ? 'currently B' : ''}
                </span>
              </div>
            );
          }

          return (
            <div
              key={runner.fieldId}
              className="grid items-center gap-0.5 rounded-md px-1 hover:bg-muted/50"
              style={{ gridTemplateColumns: 'minmax(0,1fr) 40px 40px 40px' }}
            >
              {identity}
              <RoleRadio
                compareRole="uma1"
                active={role === 'uma1'}
                runnerName={name}
                onSelect={() => handleAssign(runner.fieldId, 'uma1')}
              />
              <RoleRadio
                compareRole="uma2"
                active={role === 'uma2'}
                runnerName={name}
                onSelect={() => handleAssign(runner.fieldId, 'uma2')}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${name} from field`}
                disabled={atMin}
                onClick={() => handleRemove(runner)}
                className="size-10 text-muted-foreground hover:text-destructive"
              >
                <X className="size-4" />
              </Button>
            </div>
          );
        })}
      </div>

      <Button
        variant="outline"
        disabled={atMax}
        onClick={handleAdd}
        className="w-full justify-start gap-2 border-dashed text-muted-foreground hover:text-foreground"
      >
        <Plus className="size-4" />
        {picking ? `New uma as Compare ${pickRole === 'uma1' ? 'A' : 'B'}` : 'Add uma to field'}
      </Button>

      {!picking && (
        <div className="flex flex-col gap-2 border-t pt-2">
          <div className="flex items-center justify-between gap-3 px-1">
            <div className="min-w-0">
              <Label htmlFor="field-size-input" className="text-sm">
                Race field size
              </Label>
              <p className="text-xs text-muted-foreground">
                {mobCount > 0
                  ? `${runners.length} uma${runners.length === 1 ? '' : 's'} + ${mobCount} mob pacer${mobCount === 1 ? '' : 's'} (600 stats).`
                  : 'No mob padding — only your umas race.'}
              </p>
            </div>
            <div
              className="flex shrink-0 items-center gap-1"
              role="group"
              aria-label="Race field size"
            >
              <Button
                variant="outline"
                size="icon"
                aria-label="Decrease field size"
                disabled={compareMode === 'vacuum' || fieldSize <= MIN_FIELD_SIZE}
                onClick={() => setFieldSize(fieldSize - 1)}
              >
                <Minus className="size-3.5" />
              </Button>
              <input
                id="field-size-input"
                type="number"
                inputMode="numeric"
                min={MIN_FIELD_SIZE}
                max={MAX_FIELD_SIZE}
                value={fieldSize}
                disabled={compareMode === 'vacuum'}
                onChange={(e) => {
                  const value = Number.parseInt(e.target.value, 10);
                  if (Number.isFinite(value)) setFieldSize(clampFieldSize(value));
                }}
                className="h-8 w-12 rounded-md border bg-background text-center text-sm tabular-nums disabled:opacity-50"
              />
              <Button
                variant="outline"
                size="icon"
                aria-label="Increase field size"
                disabled={compareMode === 'vacuum' || fieldSize >= MAX_FIELD_SIZE}
                onClick={() => setFieldSize(fieldSize + 1)}
              >
                <Plus className="size-3.5" />
              </Button>
            </div>
          </div>

          {canUseVacuum(runners.length) && (
            <div className="flex items-center justify-between gap-3 px-1">
              <div className="min-w-0">
                <Label className="text-sm">Compare mode</Label>
                <p className="text-xs text-muted-foreground">
                  {compareMode === 'contested'
                    ? 'Both umas race each other; contention emerges naturally.'
                    : 'Each uma runs isolated; lowest-variance build comparison.'}
                </p>
              </div>
              <div
                role="radiogroup"
                aria-label="Compare mode"
                className="flex shrink-0 overflow-hidden rounded-md border"
              >
                {(
                  [
                    ['contested', 'Same race'],
                    ['vacuum', 'Vacuum']
                  ] as Array<[CompareMode, string]>
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={compareMode === mode}
                    onClick={() => setCompareMode(mode)}
                    className={cn(
                      'cursor-pointer px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring',
                      compareMode === mode
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-background text-muted-foreground hover:bg-muted'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
