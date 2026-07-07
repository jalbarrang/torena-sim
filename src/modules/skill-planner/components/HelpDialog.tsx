import { HelpCircleIcon } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import {
  getHintDiscountPercent,
  HINT_LEVELS,
  MAX_HINT_LEVEL,
  MIN_HINT_LEVEL
} from '@/modules/skill-planner/hint-levels';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';

const STORAGE_KEY = 'skill-planner-help-dismissed';

interface HelpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function HelpDialog({ open, onOpenChange }: HelpDialogProps) {
  const handleClose = () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HelpCircleIcon className="size-5" />
            How to Use Skill Planner
          </DialogTitle>
          <DialogDescription>
            Optimize your skill purchases to maximize Bashin gains
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 text-sm max-h-[80vh] overflow-y-auto">
          {/* Overview */}
          <div>
            <h3 className="font-semibold mb-2">What is this?</h3>
            <p className="text-muted-foreground">
              After completing a career, you receive skill hints that discount specific skills. The
              Skill Planner finds the best combination of skills to buy within your budget by
              running compare simulations to maximize your Bashin (distance) gains.
            </p>
          </div>

          {/* How Veterans work */}
          <div>
            <h3 className="font-semibold mb-2">How Veterans work</h3>
            <p className="text-muted-foreground mb-2">
              A Veteran is a saved build — stats, aptitudes, and skills. Save one from the Compare
              page or from your optimized results.
            </p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>Saving stores the build&rsquo;s full skill list as obtained.</li>
              <li>
                Importing a Veteran — or an OCR screenshot, or a planner code — loads those skills
                as already obtained; they cost 0 SP.
              </li>
              <li>
                The planner optimizes only the candidate skills you add, using the Veteran&rsquo;s
                obtained skills as the baseline.
              </li>
            </ul>
          </div>

          {/* Step-by-step guide */}
          <div>
            <h3 className="font-semibold mb-2">Quick Start Guide</h3>
            <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
              <li>
                <strong className="text-foreground">Add candidate skills</strong> - Click "Add
                Skill" and select skills from your career shop
              </li>
              <li>
                <strong className="text-foreground">Set hint levels</strong> - For each skill,
                select the discount level shown in-game (0-5)
              </li>
              <li>
                <strong className="text-foreground">Mark obtained skills</strong> - Check "Already
                Obtained" for free skills you've already unlocked
              </li>
              <li>
                <strong className="text-foreground">Set your budget</strong> - Enter available skill
                points
              </li>
              <li>
                <strong className="text-foreground">Enable Fast Learner</strong> - If you have this
                rare condition (reduces all costs by 10%)
              </li>
              <li>
                <strong className="text-foreground">Click "Optimize"</strong> - Wait 30s-2min for
                results
              </li>
            </ol>
          </div>

          {/* Hint Levels */}
          <div>
            <h3 className="font-semibold mb-2">Understanding Hint Levels</h3>
            <div className="bg-muted/50 rounded-lg p-3 space-y-1 text-xs">
              {HINT_LEVELS.map((level) => {
                const percent = getHintDiscountPercent(level);
                const suffix =
                  level === MIN_HINT_LEVEL ? ' (No hint)' : level === MAX_HINT_LEVEL ? ' (Max)' : '';

                return (
                  <div key={level} className="flex justify-between">
                    <span>
                      Hint Lvl {level}
                      {suffix}
                    </span>
                    <span
                      className={cn('font-medium', {
                        'text-blue-600': percent > 0 && percent < 30,
                        'text-green-600': percent >= 30
                      })}
                    >
                      {percent}% off
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button onClick={handleClose}>Got it!</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Hook to manage help dialog visibility
export function useHelpDialog() {
  const [open, setOpen] = useState(false);

  return { open, setOpen };
}
