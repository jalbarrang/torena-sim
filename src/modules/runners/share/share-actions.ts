import { toast } from 'sonner';
import { toBlob } from 'html-to-image';
import { encodeSingleUma } from './encoding';
import { runnerStateToSingleExport } from './converters';
import type { IRunnerState } from '@/modules/runners/components/runner-card/domain/runner-state';
import { skillsService } from '@/modules/data/services/SkillService';

export function getSkillsForShareCard(skillIds: string[]) {
  return skillIds.map((id) => {
    const skill = skillsService.getById(id);
    return {
      id,
      name: skill?.name ?? `Skill ${id}`,
      iconId: skill?.iconId ?? '',
      rarity: skill?.rarity ?? 1
    };
  });
}

export async function copyRosterViewCode(runner: IRunnerState, createdAt?: number) {
  try {
    const exportData = runnerStateToSingleExport(runner, createdAt);
    const code = encodeSingleUma(exportData);
    await navigator.clipboard.writeText(code);
    toast.success('RosterView code copied to clipboard');
  } catch {
    toast.error('Failed to copy code');
  }
}

export async function downloadJson(runner: IRunnerState, filename: string, createdAt?: number) {
  try {
    const exportData = runnerStateToSingleExport(runner, createdAt);
    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('JSON file downloaded');
  } catch {
    toast.error('Failed to download JSON');
  }
}

const TRANSPARENT_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAABJRU5ErkJggg==';

function imageToDataUri(img: HTMLImageElement): Promise<string> {
  return new Promise((resolve) => {
    if (img.src.startsWith('data:')) {
      resolve(img.src);
      return;
    }

    const url = img.src.startsWith('/') ? window.location.origin + img.src : img.src;

    const loader = new Image();
    loader.crossOrigin = 'anonymous';
    loader.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = loader.naturalWidth;
      canvas.height = loader.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(loader, 0, 0);
      try {
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(TRANSPARENT_PIXEL);
      }
    };
    loader.onerror = () => resolve(TRANSPARENT_PIXEL);
    loader.src = url;
  });
}

async function inlineAllImages(element: HTMLElement) {
  const images = element.querySelectorAll('img');
  await Promise.all(
    Array.from(images).map(async (img) => {
      img.src = await imageToDataUri(img);
    })
  );
}

export async function copyScreenshot(element: HTMLElement) {
  try {
    await inlineAllImages(element);

    const blob = await toBlob(element, {
      pixelRatio: 2,
      skipFonts: true,
      imagePlaceholder: TRANSPARENT_PIXEL
    });
    if (!blob) throw new Error('toBlob returned null');

    if (!navigator.clipboard?.write) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'runner-share.png';
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Screenshot saved as file (clipboard not available)');
      return;
    }

    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast.success('Screenshot copied to clipboard');
  } catch (err) {
    console.error('[share] copyScreenshot failed:', err);
    toast.error(
      `Failed to copy screenshot: ${err instanceof Error ? err.message : 'Unknown error'}`
    );
  }
}
