import { BookmarkPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type SaveRunnerModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (name: string, shouldLink: boolean) => void;
  triggerButton?: React.ReactElement;
  showLinkOption?: boolean;
};

type SaveRunnerModalContentProps = Pick<
  SaveRunnerModalProps,
  'open' | 'onOpenChange' | 'onSave' | 'showLinkOption'
>;

function SaveRunnerModalContent(props: SaveRunnerModalContentProps) {
  const { open, onOpenChange, onSave, showLinkOption = true } = props;
  const [name, setName] = useState('');
  const [shouldLink, setShouldLink] = useState(showLinkOption);

  // Reset form state whenever the dialog closes so it reopens fresh.
  // Done via effect (not a `key` remount) because remounting the Base UI
  // popup mid close-transition leaves it stuck mounted so it never closes.
  useEffect(() => {
    if (!open) {
      setName('');
      setShouldLink(showLinkOption);
    }
  }, [open, showLinkOption]);

  const handleSave = () => {
    if (!name.trim()) {
      return;
    }

    onSave(name.trim(), showLinkOption ? shouldLink : false);
    onOpenChange(false);
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && name.trim()) {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <DialogContent className="sm:max-w-[425px]">
      <DialogHeader>
        <DialogTitle>Save to Veterans</DialogTitle>
        <DialogDescription>
          Save this build to your Veterans library. All of its skills are stored as already
          obtained.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 py-4">
        <div className="grid gap-2">
          <Label htmlFor="runner-name">Runner Notes *</Label>
          <Input
            id="runner-name"
            placeholder="e.g., Speed Build, Stamina Build, etc."
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            // eslint-disable-next-line jsx-a11y/no-autofocus -- modal should focus the primary text input when opened
            autoFocus
            maxLength={255}
          />
        </div>

        {showLinkOption && (
          <div className="flex items-center gap-2">
            <Checkbox
              id="link-runner"
              checked={shouldLink}
              onCheckedChange={(checked) => setShouldLink(checked === true)}
            />
            <Label htmlFor="link-runner" className="cursor-pointer font-normal">
              Link runner after saving (sync future changes)
            </Label>
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={handleCancel}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={!name.trim()}>
          <BookmarkPlus className="mr-2" />
          Save
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

export const SaveRunnerModal = ({
  open,
  onOpenChange,
  onSave,
  triggerButton,
  showLinkOption = true
}: SaveRunnerModalProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {triggerButton && <DialogTrigger render={triggerButton} />}
      <SaveRunnerModalContent
        open={open}
        onOpenChange={onOpenChange}
        onSave={onSave}
        showLinkOption={showLinkOption}
      />
    </Dialog>
  );
};
