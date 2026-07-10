import type { TimelineAnniversary, TimelinePayload } from '@/modules/carat/data/timeline-types';
import type { PaidPackPurchases } from '@/modules/carat/model/paid';

type SelectorStepUp = {
  rarity: '3star' | 'ssr';
  steps: number;
  guaranteedSlots: number;
};

export type SelectorAnniversary = {
  id: string;
  label: string;
  startDate: string | null;
  endDate: string | null;
  caratPacks: PaidPackPurchases;
  selectors: {
    uma: string[];
    ssr: string[];
  };
  stepUps: SelectorStepUp[];
  isConfirmed: boolean;
};

type SelectorAnniversarySeed = Omit<
  SelectorAnniversary,
  'startDate' | 'endDate' | 'label' | 'isConfirmed'
> & {
  label?: string;
};

const defaultCaratPacks: PaidPackPurchases = { p11000: 0, p7500: 0, p1500: 0 };

function slug(value: string) {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '');
}

// extracted from spreadsheet v5.3 — extend as needed
// TODO: Fill exhaustive selector rosters once the spreadsheet extract is available.
const selectorAnniversarySeeds: Record<string, SelectorAnniversarySeed> = {
  '0-5th-anniversary': {
    id: '0-5th-anniversary',
    selectors: { uma: ['Tokai Teio', 'Mejiro McQueen'], ssr: ['Kitasan Black'] },
    stepUps: [{ rarity: '3star', steps: 5, guaranteedSlots: 1 }],
    caratPacks: defaultCaratPacks
  },
  '1st-anniversary': {
    id: '1st-anniversary',
    selectors: { uma: ['Mihono Bourbon', 'Rice Shower'], ssr: ['Fine Motion', 'Super Creek'] },
    stepUps: [
      { rarity: '3star', steps: 5, guaranteedSlots: 1 },
      { rarity: 'ssr', steps: 5, guaranteedSlots: 1 }
    ],
    caratPacks: defaultCaratPacks
  },
  '1-5th-anniversary': {
    id: '1-5th-anniversary',
    selectors: { uma: [], ssr: [] },
    stepUps: [{ rarity: 'ssr', steps: 5, guaranteedSlots: 1 }],
    caratPacks: defaultCaratPacks
  },
  '2nd-anniversary': {
    id: '2nd-anniversary',
    selectors: { uma: [], ssr: [] },
    stepUps: [
      { rarity: '3star', steps: 5, guaranteedSlots: 1 },
      { rarity: 'ssr', steps: 5, guaranteedSlots: 1 }
    ],
    caratPacks: defaultCaratPacks
  },
  '2-5th-anniversary': {
    id: '2-5th-anniversary',
    selectors: { uma: [], ssr: [] },
    stepUps: [{ rarity: 'ssr', steps: 5, guaranteedSlots: 1 }],
    caratPacks: defaultCaratPacks
  },
  '3rd-anniversary': {
    id: '3rd-anniversary',
    selectors: { uma: [], ssr: [] },
    stepUps: [
      { rarity: '3star', steps: 5, guaranteedSlots: 1 },
      { rarity: 'ssr', steps: 5, guaranteedSlots: 1 }
    ],
    caratPacks: defaultCaratPacks
  },
  '3-5th-anniversary': {
    id: '3-5th-anniversary',
    selectors: { uma: [], ssr: [] },
    stepUps: [{ rarity: 'ssr', steps: 5, guaranteedSlots: 1 }],
    caratPacks: defaultCaratPacks
  },
  '4th-anniversary': {
    id: '4th-anniversary',
    selectors: { uma: [], ssr: [] },
    stepUps: [
      { rarity: '3star', steps: 5, guaranteedSlots: 1 },
      { rarity: 'ssr', steps: 5, guaranteedSlots: 1 }
    ],
    caratPacks: defaultCaratPacks
  }
};

function timelineAnniversaryId(anniversary: TimelineAnniversary) {
  const label = String(
    anniversary.label ??
      anniversary.index ??
      anniversary.global_date ??
      anniversary.date ??
      'anniversary'
  );
  return slug(label.toLowerCase().includes('anniversary') ? label : `${label}-anniversary`);
}

function startDate(anniversary: TimelineAnniversary) {
  return String(anniversary.global_date ?? anniversary.date ?? anniversary.jp_date ?? '') || null;
}

function endDateFromStart(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + 27);
  return date.toISOString();
}

export function selectorAnniversariesFromTimeline(
  timeline: TimelinePayload
): SelectorAnniversary[] {
  return timeline.anniversaries.map((anniversary) => {
    const id = timelineAnniversaryId(anniversary);
    const seed = selectorAnniversarySeeds[id];
    const date = startDate(anniversary);

    return {
      id,
      label: seed?.label ?? String(anniversary.label ?? id),
      startDate: date,
      endDate: endDateFromStart(date),
      caratPacks: seed?.caratPacks ?? defaultCaratPacks,
      selectors: seed?.selectors ?? { uma: [], ssr: [] },
      stepUps: seed?.stepUps ?? [
        { rarity: '3star', steps: 5, guaranteedSlots: 1 },
        { rarity: 'ssr', steps: 5, guaranteedSlots: 1 }
      ],
      isConfirmed: Boolean(anniversary.is_confirmed)
    };
  });
}
