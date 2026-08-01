import { useRef, type ChangeEvent, type DragEvent } from 'react';
import { ShieldOff } from 'lucide-react';
import type { PreparedImage } from '@/modules/runners/components/ocr/types';
import { cn } from '@/lib/utils';

const EMPTY_THUMBNAILS: PreparedImage[] = [];

type DropZoneProps = {
  label: string;
  description: string;
  icon: React.ReactNode;
  accept?: string;
  disabled?: boolean;
  unavailable?: boolean;
  thumbnails?: Array<PreparedImage>;
  onFiles: (files: Array<File>) => void;
};

export function DropZone(props: Readonly<DropZoneProps>) {
  const {
    label,
    description,
    icon,
    accept = 'image/*',
    disabled = false,
    unavailable = false,
    thumbnails = EMPTY_THUMBNAILS,
    onFiles
  } = props;

  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files ?? []).filter((file) =>
      file.type.startsWith('image/')
    );
    if (files.length > 0) {
      onFiles(files);
    }
  };

  const selectScreenshotFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter((file) => file.type.startsWith('image/'));
    if (files.length > 0) {
      onFiles(files);
    }
    e.target.value = '';
  };

  const handleOpenFilePicker = () => {
    if (!disabled) {
      inputRef.current?.click();
    }
  };

  if (unavailable) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-4 text-center">
        <ShieldOff className="size-8 text-muted-foreground" />
        <div className="space-y-1">
          <p className="text-sm font-medium">Screenshot import unavailable</p>
          <p className="text-xs text-muted-foreground max-w-[220px]">
            Screenshot import isn&apos;t configured for this build.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex-1 flex flex-col gap-3 rounded-lg border-2 border-dashed p-4 transition-colors cursor-pointer',
        disabled ? 'opacity-50 pointer-events-none' : 'hover:border-muted-foreground/50'
      )}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={handleOpenFilePicker}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleOpenFilePicker();
        }
      }}
    >
      <div className="flex flex-col items-center justify-center gap-2 text-center flex-1 py-4">
        <div className="text-muted-foreground">{icon}</div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground max-w-[180px]">{description}</p>
      </div>

      {thumbnails.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {thumbnails.map((img, index) => (
            <div key={img.preview} className="size-12 rounded border overflow-hidden shrink-0">
              <img
                src={img.preview}
                alt={
                  img.name ? `Screenshot preview: ${img.name}` : `Screenshot preview ${index + 1}`
                }
                className="w-full h-full object-cover"
              />
            </div>
          ))}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        className="hidden"
        onChange={selectScreenshotFiles}
        disabled={disabled}
      />
    </div>
  );
}
