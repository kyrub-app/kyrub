import {
  deriveKyrubEconomicPositions,
  normalizeKyrubEconomicLedger,
  type KyrubEconomicLedger,
  type KyrubEconomicPaymentMethod,
} from './kyrubEconomicLedger.js';

export interface KyrubPlatformEconomicsSlice {
  key: string;
  ledgerCount: number;
  gmvMinor: number;
  consumerPaidMinor: number;
  platformRevenueMinor: number;
  platformCostsMinor: number;
  platformNetMinor: number;
}

export interface KyrubPlatformEconomicsSummary {
  generatedAt: string;
  scannedLedgers: number;
  includedLedgers: number;
  truncated: boolean;
  totals: {
    gmvMinor: number;
    consumerPaidMinor: number;
    discountsMinor: number;
    freightMinor: number;
    tipsMinor: number;
    subsidiesMinor: number;
    incentivesMinor: number;
    platformRevenueMinor: number;
    financialCostsMinor: number;
    taxesMinor: number;
    workerEarningsMinor: number;
    platformCostsMinor: number;
    platformNetMinor: number;
  };
  coverage: {
    transactionLedger: 'authoritative';
    infrastructureCosts: 'not_modeled';
    aiCosts: 'not_modeled';
  };
  byPaymentMethod: KyrubPlatformEconomicsSlice[];
  byProvider: KyrubPlatformEconomicsSlice[];
  byStore: KyrubPlatformEconomicsSlice[];
}

const WORKER_ROLES = new Set(['courier', 'freelancer', 'service_provider']);

const blankSlice = (key: string): KyrubPlatformEconomicsSlice => ({
  key,
  ledgerCount: 0,
  gmvMinor: 0,
  consumerPaidMinor: 0,
  platformRevenueMinor: 0,
  platformCostsMinor: 0,
  platformNetMinor: 0,
});

const pushSlice = (
  map: Map<string, KyrubPlatformEconomicsSlice>,
  key: string,
  values: Omit<KyrubPlatformEconomicsSlice, 'key'>
): void => {
  const slice = map.get(key) ?? blankSlice(key);
  slice.ledgerCount += values.ledgerCount;
  slice.gmvMinor += values.gmvMinor;
  slice.consumerPaidMinor += values.consumerPaidMinor;
  slice.platformRevenueMinor += values.platformRevenueMinor;
  slice.platformCostsMinor += values.platformCostsMinor;
  slice.platformNetMinor += values.platformNetMinor;
  map.set(key, slice);
};

const sortSlices = (map: Map<string, KyrubPlatformEconomicsSlice>) =>
  Array.from(map.values()).sort((a, b) => b.gmvMinor - a.gmvMinor || a.key.localeCompare(b.key));

export const deriveKyrubPlatformEconomics = (input: {
  ledgers: KyrubEconomicLedger[];
  generatedAt?: string;
  scannedLedgers?: number;
  truncated?: boolean;
}): KyrubPlatformEconomicsSummary => {
  const totals = {
    gmvMinor: 0,
    consumerPaidMinor: 0,
    discountsMinor: 0,
    freightMinor: 0,
    tipsMinor: 0,
    subsidiesMinor: 0,
    incentivesMinor: 0,
    platformRevenueMinor: 0,
    financialCostsMinor: 0,
    taxesMinor: 0,
    workerEarningsMinor: 0,
    platformCostsMinor: 0,
    platformNetMinor: 0,
  };
  const byPaymentMethod = new Map<string, KyrubPlatformEconomicsSlice>();
  const byProvider = new Map<string, KyrubPlatformEconomicsSlice>();
  const byStore = new Map<string, KyrubPlatformEconomicsSlice>();

  const ledgers = input.ledgers.map(normalizeKyrubEconomicLedger);
  for (const ledger of ledgers) {
    let gmvMinor = 0;
    let platformRevenueMinor = 0;
    let platformCostsMinor = 0;

    for (const entry of ledger.entries) {
      if (entry.kind === 'sale') {
        totals.gmvMinor += entry.amountMinor;
        gmvMinor += entry.amountMinor;
      }
      if (entry.kind === 'discount') totals.discountsMinor += entry.amountMinor;
      if (entry.kind === 'freight') totals.freightMinor += entry.amountMinor;
      if (entry.kind === 'tip') totals.tipsMinor += entry.amountMinor;
      if (entry.kind === 'subsidy') totals.subsidiesMinor += entry.amountMinor;
      if (entry.kind === 'incentive') totals.incentivesMinor += entry.amountMinor;
      if (entry.kind === 'financial_cost') totals.financialCostsMinor += entry.amountMinor;
      if (entry.kind === 'tax') totals.taxesMinor += entry.amountMinor;
      if (entry.kind === 'platform_fee' && entry.owedTo.role === 'platform') {
        totals.platformRevenueMinor += entry.amountMinor;
        platformRevenueMinor += entry.amountMinor;
      }
      if (entry.fundedBy.role === 'platform') {
        totals.platformCostsMinor += entry.amountMinor;
        platformCostsMinor += entry.amountMinor;
      }
      if (WORKER_ROLES.has(entry.owedTo.role)) {
        totals.workerEarningsMinor += entry.amountMinor;
      }
    }

    const positions = deriveKyrubEconomicPositions(ledger.entries);
    const buyerNet = positions
      .filter(position => position.role === 'buyer')
      .reduce((sum, position) => sum + position.netMinor, 0);
    const platformNet = positions
      .filter(position => position.role === 'platform')
      .reduce((sum, position) => sum + position.netMinor, 0);
    const consumerPaidMinor = Math.max(0, -buyerNet);
    totals.consumerPaidMinor += consumerPaidMinor;
    totals.platformNetMinor += platformNet;

    const sliceValues = {
      ledgerCount: 1,
      gmvMinor,
      consumerPaidMinor,
      platformRevenueMinor,
      platformCostsMinor,
      platformNetMinor: platformNet,
    };
    pushSlice(byStore, ledger.storeId, sliceValues);
    pushSlice(byPaymentMethod, ledger.paymentMethod ?? 'not_applicable', sliceValues);
    pushSlice(byProvider, ledger.paymentProvider || 'not_applicable', sliceValues);
  }

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    scannedLedgers: input.scannedLedgers ?? ledgers.length,
    includedLedgers: ledgers.length,
    truncated: input.truncated === true,
    totals,
    coverage: {
      transactionLedger: 'authoritative',
      infrastructureCosts: 'not_modeled',
      aiCosts: 'not_modeled',
    },
    byPaymentMethod: sortSlices(byPaymentMethod),
    byProvider: sortSlices(byProvider),
    byStore: sortSlices(byStore),
  };
};

export const isKyrubEconomicPaymentMethod = (
  value: string
): value is KyrubEconomicPaymentMethod =>
  value === 'pix' || value === 'card' || value === 'cash' || value === 'other';
