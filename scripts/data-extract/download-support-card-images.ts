#!/usr/bin/env tsx
/**
 * Download support card thumbnail art used by the development support card viewer.
 *
 * Images are cached locally and skipped when already present.
 */

import { Command } from 'commander';
import { access, mkdir, writeFile } from 'node:fs/promises';
import supportCardsJson from '../../src/modules/data/json/support-cards.json';

type DownloadSupportCardImagesOptions = {
  outputDir: string;
  force: boolean;
  sourceBaseUrl: string;
};

type SupportCardEntry = {
  id: number;
};

const DEFAULT_OUTPUT_DIR = 'public/img/support-cards';
const DEFAULT_SOURCE_BASE_URL = 'https://euophrys.github.io/uma-tiers/cardImages';

function parseCliArgs(argv: Array<string>): DownloadSupportCardImagesOptions {
  const program = new Command();

  program
    .name('download-support-card-images')
    .description('Download support card images if they are not already cached locally')
    .option('-o, --output-dir <path>', 'directory to write images to', DEFAULT_OUTPUT_DIR)
    .option('-f, --force', 'redownload images even when they already exist')
    .option(
      '--source-base-url <url>',
      'base URL that hosts support_card_s_<id>.png images',
      DEFAULT_SOURCE_BASE_URL
    );

  program.parse(argv);

  const options = program.opts<{
    outputDir: string;
    force?: boolean;
    sourceBaseUrl: string;
  }>();

  return {
    outputDir: options.outputDir,
    force: Boolean(options.force),
    sourceBaseUrl: options.sourceBaseUrl.replace(/\/$/, '')
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  return access(filePath).then(
    () => true,
    () => false
  );
}

function getSupportCardImageFileName(cardId: number) {
  return `support_card_s_${cardId}.png`;
}

async function downloadSupportCardImage(
  cardId: number,
  options: DownloadSupportCardImagesOptions
): Promise<'downloaded' | 'skipped' | 'failed'> {
  const fileName = getSupportCardImageFileName(cardId);
  const outputPath = `${options.outputDir.replace(/\/$/, '')}/${fileName}`;

  if (!options.force && (await fileExists(outputPath))) {
    return 'skipped';
  }

  const imageUrl = `${options.sourceBaseUrl}/${fileName}`;
  const response = await fetch(imageUrl);

  if (!response.ok) {
    console.warn(`Failed to download ${imageUrl}: ${response.status} ${response.statusText}`);
    return 'failed';
  }

  await writeFile(outputPath, Buffer.from(await response.arrayBuffer()));

  return 'downloaded';
}

async function downloadSupportCardImages(options: DownloadSupportCardImagesOptions) {
  const supportCards = Object.values(supportCardsJson) as Array<SupportCardEntry>;
  const cardIds = supportCards.map((card) => card.id).sort((a, b) => a - b);

  await mkdir(options.outputDir, { recursive: true });

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const cardId of cardIds) {
    const result = await downloadSupportCardImage(cardId, options);

    if (result === 'downloaded') downloaded += 1;
    if (result === 'skipped') skipped += 1;
    if (result === 'failed') failed += 1;
  }

  console.log(
    `Support card images: ${downloaded} downloaded, ${skipped} skipped, ${failed} failed`
  );
  console.log(`Output directory: ${options.outputDir}`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  const options = parseCliArgs(process.argv);

  downloadSupportCardImages(options).catch((error) => {
    console.error('Failed to download support card images:', error.message);
    process.exit(1);
  });
}

export { downloadSupportCardImages, parseCliArgs };
export type { DownloadSupportCardImagesOptions };
