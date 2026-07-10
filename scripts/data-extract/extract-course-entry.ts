/**
 * Extract one course entry from src/modules/data/course_data.json.
 *
 * Usage:
 *   pnpm exec tsx scripts/data-extract/extract-course-entry.ts --course-id 10914
 *   pnpm exec tsx scripts/data-extract/extract-course-entry.ts -c 10914 --compact
 *   pnpm exec tsx scripts/data-extract/extract-course-entry.ts -c 10914 --source path/to/course_data.json
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command, InvalidArgumentError } from 'commander';

type CliOptions = {
  courseId: number;
  sourcePath: string;
  compact: boolean;
};

const DEFAULT_SOURCE_PATH = 'src/modules/data/json/course_data.json';

function parseCourseId(value: string): number {
  const courseId = Number.parseInt(value, 10);
  if (!Number.isInteger(courseId) || courseId <= 0) {
    throw new InvalidArgumentError(`Invalid course ID: ${value}`);
  }
  return courseId;
}

function parseArgs(argv: Array<string>): CliOptions {
  // `pnpm run <script> -- ...` can forward a standalone `--` token.
  const normalizedArgv = argv.filter((arg) => arg !== '--');
  const program = new Command();
  program
    .name('extract-course-entry')
    .description('Extract one course entry by courseId.')
    .requiredOption('-c, --course-id <id>', 'Course ID to extract (e.g. 10914)', parseCourseId)
    .option(
      '-s, --source <path>',
      `Path to course_data.json (default: ${DEFAULT_SOURCE_PATH})`,
      DEFAULT_SOURCE_PATH
    )
    .option('--compact', 'Print compact JSON instead of pretty JSON', false)
    .showHelpAfterError();

  program.parse(normalizedArgv, { from: 'user' });
  const options = program.opts<{
    courseId: number;
    source: string;
    compact: boolean;
  }>();

  return {
    courseId: options.courseId,
    sourcePath: options.source,
    compact: options.compact
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const absolutePath = resolve(options.sourcePath);
  const raw = readFileSync(absolutePath, 'utf8');
  const courseData = JSON.parse(raw) as Record<string, unknown>;
  const key = String(options.courseId);
  const entry = courseData[key];

  if (!entry) {
    console.error(`Course ID ${options.courseId} was not found in ${options.sourcePath}`);
    process.exit(1);
  }

  const output = {
    courseId: options.courseId,
    data: entry
  };

  const indent = options.compact ? 0 : 2;
  console.log(JSON.stringify(output, null, indent));
}

main();
