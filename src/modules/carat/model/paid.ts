import type { CaratServer } from '@/store/carat.store';

type PaidPackId = 'p11000' | 'p7500' | 'p1500';

export type PaidPackPurchases = Record<PaidPackId, number>;

export type PaidPackSummary = {
  paidCarats: number;
  usd: number;
};

type PaidPackDefinition = {
  carats: number;
  usd: number;
  multiplier: Partial<Record<CaratServer, number>>;
};

const paidPackDefinitions: Record<PaidPackId, PaidPackDefinition> = {
  p11000: { carats: 11000, usd: 140, multiplier: { jp: 1.2, global: 1.1 } },
  p7500: { carats: 7500, usd: 70, multiplier: { jp: 1.1, global: 1.1 } },
  p1500: { carats: 1500, usd: 14, multiplier: { jp: 1, global: 1 } }
};

function cleanQuantity(value: number | undefined) {
  return Math.max(0, Math.floor(Number.isFinite(value) ? (value ?? 0) : 0));
}

export function paidCaratsFromPacks(
  purchases: Partial<PaidPackPurchases>,
  server: CaratServer
): PaidPackSummary {
  return (Object.keys(paidPackDefinitions) as PaidPackId[]).reduce<PaidPackSummary>(
    (summary, packId) => {
      const quantity = cleanQuantity(purchases[packId]);
      const pack = paidPackDefinitions[packId];
      const multiplier = pack.multiplier[server] ?? 1;

      return {
        paidCarats: summary.paidCarats + quantity * Math.round(pack.carats * multiplier),
        usd: summary.usd + quantity * pack.usd
      };
    },
    { paidCarats: 0, usd: 0 }
  );
}

export function totalPaidCaratsFromPurchases(
  purchasesByAnniversary: Record<string, Partial<PaidPackPurchases>>,
  server: CaratServer
): PaidPackSummary {
  return Object.values(purchasesByAnniversary).reduce<PaidPackSummary>(
    (summary, purchases) => {
      const next = paidCaratsFromPacks(purchases, server);
      return { paidCarats: summary.paidCarats + next.paidCarats, usd: summary.usd + next.usd };
    },
    { paidCarats: 0, usd: 0 }
  );
}
