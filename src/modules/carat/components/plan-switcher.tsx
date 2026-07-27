import { useState } from 'react';
import { Copy, Download, Link2, MoreVertical, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import {
  createPlan,
  deletePlan,
  duplicatePlan,
  renamePlan,
  setActivePlan,
  useCaratStore
} from '@/store/carat.store';
import { buildCaratPlanSnapshot, downloadCaratPlanSnapshot } from '@/modules/carat/share/snapshot';
import { encodeCaratPlanShareCode } from '@/modules/carat/share/share-code';
import { ImportCaratPlanDialog } from '@/modules/carat/share/import-carat-plan-dialog';

type NameDialogMode = 'create' | 'rename';

export function PlanSwitcher() {
  const plans = useCaratStore((state) => state.plans);
  const activePlanId = useCaratStore((state) => state.activePlanId);

  const [nameDialogMode, setNameDialogMode] = useState<NameDialogMode | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const activePlan = plans.find((plan) => plan.id === activePlanId) ?? plans[0];

  const openCreate = () => {
    setNameInput('');
    setNameDialogMode('create');
  };

  const openRename = () => {
    setNameInput(activePlan?.name ?? '');
    setNameDialogMode('rename');
  };

  const closeNameDialog = () => {
    setNameDialogMode(null);
    setNameInput('');
  };

  const submitNameDialog = () => {
    const trimmed = nameInput.trim();
    if (nameDialogMode === 'create') {
      createPlan(trimmed || undefined);
    } else if (nameDialogMode === 'rename' && activePlan && trimmed) {
      renamePlan(activePlan.id, trimmed);
    }
    closeNameDialog();
  };

  const handleDuplicate = () => {
    if (activePlan) duplicatePlan(activePlan.id);
  };

  const handleCopyShareCode = async () => {
    if (!navigator.clipboard) {
      toast.error('Clipboard is not available in this browser');
      return;
    }
    try {
      const code = await encodeCaratPlanShareCode(buildCaratPlanSnapshot(activePlan?.id));
      await navigator.clipboard.writeText(code);
      toast.success('Share code copied to clipboard');
    } catch {
      toast.error('Failed to copy share code');
    }
  };

  const confirmDelete = () => {
    if (activePlan) deletePlan(activePlan.id);
    setDeleteOpen(false);
  };

  return (
    <div className="flex items-center gap-1.5">
      <Select value={activePlanId} onValueChange={(next) => next && setActivePlan(next)}>
        <SelectTrigger size="sm" className="min-w-[10rem] max-w-[16rem]">
          <SelectValue>{activePlan?.name ?? 'Select plan'}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {plans.map((plan) => (
            <SelectItem key={plan.id} value={plan.id}>
              {plan.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button size="sm" variant="secondary" onClick={openCreate}>
        <Plus />
        New plan
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="icon-sm" aria-label="Plan actions">
              <MoreVertical />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={openRename}>
            <Pencil />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleDuplicate}>
            <Copy />
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void handleCopyShareCode()}>
            <Link2 />
            Copy share code
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => downloadCaratPlanSnapshot(activePlan?.id)}>
            <Download />
            Export .json
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setImportOpen(true)}>
            <Upload />
            Import plan…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={nameDialogMode !== null}
        onOpenChange={(open) => {
          if (!open) closeNameDialog();
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{nameDialogMode === 'rename' ? 'Rename plan' : 'New plan'}</DialogTitle>
            <DialogDescription>
              {nameDialogMode === 'rename'
                ? 'Give this pull plan a new name.'
                : 'Create a fresh pull plan. Leave the name blank to auto-number it.'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="carat-plan-name">Plan name</Label>
            <Input
              id="carat-plan-name"
              value={nameInput}
              placeholder={
                nameDialogMode === 'rename' ? activePlan?.name : 'e.g. Anniversary saving'
              }
              onChange={(event) => setNameInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  submitNameDialog();
                }
              }}
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={closeNameDialog}>
              Cancel
            </Button>
            <Button
              onClick={submitNameDialog}
              disabled={nameDialogMode === 'rename' && nameInput.trim() === ''}
            >
              {nameDialogMode === 'rename' ? 'Rename' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{activePlan?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes this pull plan, its banners, and settings.
              {plans.length <= 1 ? ' A fresh empty plan will be created in its place.' : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ImportCaratPlanDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
