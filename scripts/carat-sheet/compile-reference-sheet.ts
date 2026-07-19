#!/usr/bin/env node

import { inflateRawSync } from 'node:zlib';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type ZipEntry = {
  compression: number;
  compressedSize: number;
  localHeaderOffset: number;
};

type CellValue = number | string | null;

type Worksheet = Map<string, CellValue>;

type IncomeComponents = {
  timelineHandouts: number | null;
  dailyQuest: number | null;
  teamTrials: number | null;
  clubRank: number | null;
  trainingPass: number | null;
  dailyPack: number | null;
  championsMeeting: number | null;
  legendOfHeroes: number | null;
  fiftyDayLogin: number | null;
  misc: number | null;
};

const COMPONENT_COLUMNS = {
  timelineHandouts: 'AL',
  dailyQuest: 'AN',
  teamTrials: 'AO',
  clubRank: 'AP',
  trainingPass: 'AQ',
  dailyPack: 'AR',
  championsMeeting: 'AS',
  legendOfHeroes: 'AT',
  fiftyDayLogin: 'AU',
  misc: 'AV'
} as const;

const KNOWN_ERROR_VALUES = new Set(['training_pass_error', 'pack_daily_error']);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_XLSX_PATH = String.raw`C:\Users\albhax\Downloads\latias-pull-plan.xlsx`;

function readUInt32LE(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function readUInt16LE(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
}

function readZipEntries(bytes: Uint8Array): Map<string, ZipEntry> {
  const endOfCentralDirectorySignature = 0x06054b50;
  const centralDirectorySignature = 0x02014b50;
  const minEndOffset = Math.max(0, bytes.length - 65_557);
  let endOffset = -1;

  for (let offset = bytes.length - 22; offset >= minEndOffset; offset -= 1) {
    if (readUInt32LE(bytes, offset) === endOfCentralDirectorySignature) {
      endOffset = offset;
      break;
    }
  }

  if (endOffset === -1) {
    throw new Error('Invalid xlsx: ZIP end-of-central-directory record is missing.');
  }

  const entryCount = readUInt16LE(bytes, endOffset + 10);
  const centralDirectoryOffset = readUInt32LE(bytes, endOffset + 16);
  const entries = new Map<string, ZipEntry>();
  let offset = centralDirectoryOffset;
  const decoder = new TextDecoder();

  for (let index = 0; index < entryCount; index += 1) {
    if (readUInt32LE(bytes, offset) !== centralDirectorySignature) {
      throw new Error('Invalid xlsx: malformed ZIP central directory.');
    }

    const compression = readUInt16LE(bytes, offset + 10);
    const compressedSize = readUInt32LE(bytes, offset + 20);
    const fileNameLength = readUInt16LE(bytes, offset + 28);
    const extraLength = readUInt16LE(bytes, offset + 30);
    const commentLength = readUInt16LE(bytes, offset + 32);
    const localHeaderOffset = readUInt32LE(bytes, offset + 42);
    const fileNameStart = offset + 46;
    const fileName = decoder.decode(bytes.subarray(fileNameStart, fileNameStart + fileNameLength));

    entries.set(fileName, { compression, compressedSize, localHeaderOffset });
    offset = fileNameStart + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function unzipText(bytes: Uint8Array, entries: Map<string, ZipEntry>, name: string): string {
  const entry = entries.get(name);
  if (!entry) {
    throw new Error(`Invalid xlsx: missing ${name}.`);
  }

  const localHeaderSignature = 0x04034b50;
  const { localHeaderOffset } = entry;
  if (readUInt32LE(bytes, localHeaderOffset) !== localHeaderSignature) {
    throw new Error(`Invalid xlsx: malformed local header for ${name}.`);
  }

  const fileNameLength = readUInt16LE(bytes, localHeaderOffset + 26);
  const extraLength = readUInt16LE(bytes, localHeaderOffset + 28);
  const contentStart = localHeaderOffset + 30 + fileNameLength + extraLength;
  const compressed = bytes.subarray(contentStart, contentStart + entry.compressedSize);
  const content =
    entry.compression === 0
      ? compressed
      : entry.compression === 8
        ? inflateRawSync(compressed)
        : (() => {
            throw new Error(`Unsupported ZIP compression method ${entry.compression} for ${name}.`);
          })();

  return new TextDecoder().decode(content);
}

function decodeXml(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function extractTagText(xml: string, tag: string): string | undefined {
  const match = new RegExp(String.raw`<${tag}(?:\s[^>]*)?>([\s\S]*?)<\/${tag}>`).exec(xml);
  return match ? decodeXml(match[1]) : undefined;
}

function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((match) =>
    [...match[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
      .map((text) => decodeXml(text[1]))
      .join('')
  );
}

function parseCellValue(
  content: string,
  type: string | undefined,
  sharedStrings: string[]
): CellValue {
  const rawValue = extractTagText(content, 'v');
  if (rawValue === undefined) {
    if (type === 'inlineStr') {
      return [...content.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
        .map((match) => decodeXml(match[1]))
        .join('');
    }
    return null;
  }

  if (type === 's') {
    const shared = sharedStrings[Number(rawValue)];
    return shared ?? null;
  }

  if (type === 'str' || type === 'e') {
    return KNOWN_ERROR_VALUES.has(rawValue) || rawValue.endsWith('_error') ? null : rawValue;
  }

  const parsed = Number(rawValue);
  return Number.isNaN(parsed) ? rawValue : parsed;
}

function parseWorksheet(xml: string, sharedStrings: string[]): Worksheet {
  const cells = new Map<string, CellValue>();
  const cellPattern = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;

  for (const match of xml.matchAll(cellPattern)) {
    const attributes = match[1];
    const reference = /\br="([^"]+)"/.exec(attributes)?.[1];
    if (!reference) continue;

    const type = /\bt="([^"]+)"/.exec(attributes)?.[1];
    cells.set(reference, parseCellValue(match[2] ?? '', type, sharedStrings));
  }

  return cells;
}

function cell(sheet: Worksheet, reference: string): CellValue {
  return sheet.get(reference) ?? null;
}

function numberCell(sheet: Worksheet, reference: string): number | null {
  const value = cell(sheet, reference);
  return typeof value === 'number' ? value : null;
}

function textCell(sheet: Worksheet, reference: string): string | null {
  const value = cell(sheet, reference);
  return typeof value === 'string' ? value : null;
}

function excelDate(serial: number | null): string | null {
  if (serial === null) return null;
  return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10);
}

function incomeComponents(sheet: Worksheet, row: number): IncomeComponents {
  return Object.fromEntries(
    Object.entries(COMPONENT_COLUMNS).map(([name, column]) => [
      name,
      numberCell(sheet, `${column}${row}`)
    ])
  ) as IncomeComponents;
}

function firstText(...values: Array<string | null>): string | null {
  return values.find((value) => value !== null && value.trim() !== '') ?? null;
}

function buildBanners(sheet: Worksheet) {
  const banners = [];

  for (let dataRow = 42; dataRow <= 341; dataRow += 1) {
    const type = textCell(sheet, `C${dataRow}`);
    if (!type || !['Uma', 'Support', 'Step Up'].includes(type)) continue;

    const incomeRow = dataRow - 1;
    const firstRow = Math.max(42, incomeRow);
    const startSerial = numberCell(sheet, `K${dataRow}`);
    const endSerial = numberCell(sheet, `L${dataRow}`);
    const timelineStartSerial =
      numberCell(sheet, `AH${incomeRow}`) ?? numberCell(sheet, `AH${dataRow}`);
    const name = firstText(
      textCell(sheet, `F${dataRow}`),
      textCell(sheet, `D${incomeRow}`),
      textCell(sheet, `D${dataRow}`)
    );
    if (!name || name === 'N/A') continue;

    banners.push({
      rows: { first: firstRow, data: dataRow },
      name,
      type,
      start: { serial: startSerial, date: excelDate(startSerial) },
      end: { serial: endSerial, date: excelDate(endSerial) },
      timelineStart: { serial: timelineStartSerial, date: excelDate(timelineStartSerial) },
      plannedPulls: numberCell(sheet, `Q${dataRow}`),
      runningBalances: {
        free: numberCell(sheet, `M${dataRow}`),
        paid: numberCell(sheet, `N${dataRow}`)
      },
      income: incomeComponents(sheet, incomeRow)
    });
  }

  return banners;
}

function validate(result: {
  userInputs: {
    freeCarats: CellValue;
    paidCarats: CellValue;
  };
  banners: Array<{ name: string | null; type: string; income: IncomeComponents }>;
  summary: {
    averageMonthlyCarats: CellValue;
    sixtyDayCarats: CellValue;
    yearCarats: CellValue;
  };
}): void {
  const expected = {
    'summary.averageMonthlyCarats': [result.summary.averageMonthlyCarats, 19_700],
    'summary.sixtyDayCarats': [result.summary.sixtyDayCarats, 38_495],
    'summary.yearCarats': [result.summary.yearCarats, 243_595],
    'userInputs.freeCarats': [result.userInputs.freeCarats, 103_191],
    'userInputs.paidCarats': [result.userInputs.paidCarats, 13_601]
  } as const;

  const mismatches = Object.entries(expected).filter(
    ([, [actual, expectedValue]]) => actual !== expectedValue
  );
  if (mismatches.length > 0) {
    throw new Error(
      `Known value mismatch: ${mismatches
        .map(
          ([name, [actual, expectedValue]]) =>
            `${name} expected ${expectedValue}, found ${String(actual)}`
        )
        .join('; ')}.`
    );
  }

  if (result.banners.length < 25) {
    throw new Error(`Expected at least 25 banner entries, found ${result.banners.length}.`);
  }

  const missingNames = result.banners.filter((banner) => banner.name === null);
  if (missingNames.length > 0) {
    throw new Error(
      `Banner names are empty for rows ${missingNames.map((banner) => banner.type).join(', ')}.`
    );
  }

  const emptyColumns = Object.keys(COMPONENT_COLUMNS).filter((component) =>
    result.banners.every((banner) => banner.income[component as keyof IncomeComponents] === null)
  );
  if (emptyColumns.length > 0) {
    throw new Error(
      `Per-banner income columns are empty or misaligned: ${emptyColumns.join(', ')}. ` +
        `Expected columns ${Object.entries(COMPONENT_COLUMNS)
          .map(([component, column]) => `${component}=${column}`)
          .join(', ')} on each block's first row.`
    );
  }
}

function trimmedFixture(result: {
  source: { file: string; sheets: { caratCalculator: string; timeline: string } };
  anchors: {
    timelineNow: { serial: number | null; date: string | null };
    incomeStart: { serial: number | null; date: string | null };
  };
  banners: ReturnType<typeof buildBanners>;
  summary: Record<string, CellValue>;
}) {
  return {
    source: result.source,
    anchors: result.anchors,
    banners: result.banners.map((banner) => ({
      name: banner.name,
      type: banner.type,
      start: banner.start,
      end: banner.end,
      income: banner.income
    })),
    summary: result.summary
  };
}

async function main(): Promise<void> {
  const inputPath = path.resolve(process.argv[2] ?? DEFAULT_XLSX_PATH);
  const input = await readFile(inputPath);
  const entries = readZipEntries(input);
  const workbookXml = unzipText(input, entries, 'xl/workbook.xml');
  const sheetNames = [...workbookXml.matchAll(/<sheet\b[^>]*\bname="([^"]+)"/g)].map(
    (match) => match[1]
  );
  const sharedStrings = parseSharedStrings(unzipText(input, entries, 'xl/sharedStrings.xml'));
  const caratCalculator = parseWorksheet(
    unzipText(input, entries, 'xl/worksheets/sheet1.xml'),
    sharedStrings
  );
  const timeline = parseWorksheet(
    unzipText(input, entries, 'xl/worksheets/sheet2.xml'),
    sharedStrings
  );

  const result = {
    source: {
      file: path.basename(inputPath),
      sheets: {
        caratCalculator: sheetNames[0] ?? 'Sheet1',
        timeline: sheetNames[1] ?? 'Sheet2'
      }
    },
    anchors: {
      timelineNow: {
        serial: numberCell(caratCalculator, 'AG2'),
        date: excelDate(numberCell(caratCalculator, 'AG2'))
      },
      incomeStart: {
        serial: numberCell(caratCalculator, 'AG3'),
        date: excelDate(numberCell(caratCalculator, 'AG3'))
      }
    },
    userInputs: {
      freeCarats: numberCell(caratCalculator, 'D37'),
      paidCarats: numberCell(caratCalculator, 'D39'),
      umaTickets: numberCell(caratCalculator, 'F37'),
      supportTickets: numberCell(caratCalculator, 'F39'),
      settings: {
        teamTrialsClass: cell(caratCalculator, 'E29'),
        clubRank: cell(caratCalculator, 'E30'),
        championsMeetingPlacement: cell(caratCalculator, 'E31'),
        legendOfHeroesRank: cell(caratCalculator, 'E32'),
        dailyCaratPack: cell(caratCalculator, 'E33'),
        trainingPass: cell(caratCalculator, 'E34')
      }
    },
    banners: buildBanners(caratCalculator),
    summary: {
      sixtyDayCarats: numberCell(caratCalculator, 'AI342'),
      sixtyDayDays: numberCell(caratCalculator, 'AI343'),
      yearCarats: numberCell(caratCalculator, 'AI345'),
      yearDays: numberCell(caratCalculator, 'AI346'),
      averageMonthlyCarats: numberCell(caratCalculator, 'J37'),
      averageMonthlyTickets: numberCell(caratCalculator, 'J38'),
      shards: numberCell(caratCalculator, 'J39')
    },
    timeline: {
      cellCount: timeline.size
    }
  };

  validate(result);

  const resultDirectory = path.join(ROOT, 'results', 'reference-sheet');
  const fixturePath = path.join(
    ROOT,
    'src',
    'modules',
    'carat',
    'model',
    '__fixtures__',
    'reference-latias.json'
  );
  await mkdir(resultDirectory, { recursive: true });
  await mkdir(path.dirname(fixturePath), { recursive: true });
  await writeFile(
    path.join(resultDirectory, 'latias-pull-plan.json'),
    `${JSON.stringify(result, null, 2)}\n`
  );
  await writeFile(fixturePath, `${JSON.stringify(trimmedFixture(result), null, 2)}\n`);

  console.log(
    `Compiled ${result.banners.length} banners; ${result.timeline.cellCount} timeline cells; ` +
      `summary monthly=${result.summary.averageMonthlyCarats}, 60d=${result.summary.sixtyDayCarats}, ` +
      `1y=${result.summary.yearCarats}.`
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(message);
  process.exit(1);
});
