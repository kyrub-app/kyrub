export type KyrubEconomyUnit = 'store_points' | 'kcoins' | 'xp' | 'financial_balance';

export type EconomyTransferRequest = {
  from: KyrubEconomyUnit;
  to: KyrubEconomyUnit;
  amount: number;
  storeId?: string;
};

export const assertNoAutomaticEconomicConversion = (request: EconomyTransferRequest) => {
  if (!Number.isSafeInteger(request.amount) || request.amount <= 0) {
    throw new Error('ECONOMY_AMOUNT_INVALID');
  }

  if (request.from === request.to) return request;

  const protectedUnits = new Set<KyrubEconomyUnit>(['store_points', 'kcoins', 'financial_balance']);
  if (protectedUnits.has(request.from) || protectedUnits.has(request.to)) {
    throw new Error('AUTOMATIC_ECONOMIC_CONVERSION_FORBIDDEN');
  }

  throw new Error('ECONOMY_CONVERSION_UNSUPPORTED');
};

export const economicUnitsAreDistinct = (left: KyrubEconomyUnit, right: KyrubEconomyUnit): boolean => left !== right;
