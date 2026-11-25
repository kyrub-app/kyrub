// Pure projection of already reconciled, authorized inputs. No data collection,
// persistence, billing API, or financial authority is established here.
export const OWN_REVENUE_CATEGORIES = ['plans', 'ads', 'tags', 'platform_fees', 'other_own_revenue'] as const;
export const OWN_COST_CATEGORIES = ['firebase_gcp', 'vercel', 'other_infrastructure', 'providers', 'operations', 'tag_costs', 'payment_fees', 'platform_incentives', 'taxes', 'other_own_cost'] as const;
export const FINOPS_CATEGORIES = [...OWN_REVENUE_CATEGORIES, ...OWN_COST_CATEGORIES] as const;
export type FinopsCategory = typeof FINOPS_CATEGORIES[number];
export type FinopsPeriod = { month: string; timezone: 'America/Sao_Paulo'; basis: 'cash' | 'accrual'; currency: 'BRL' };
export type FinopsFact = {
  period: FinopsPeriod;
  category: FinopsCategory;
  // Canonical reconciled ID, not a provider row ID. Reversals are separate facts.
  factId: string;
  sourceRef: string;
  // Net signed effect in the category: positive income/cost, negative reversal.
  amountMinor: number;
  quality: 'confirmed' | 'estimated';
  fxEvidenceRef?: string;
  originalCurrency: string;
};
export type FinopsCoverage = {
  period: FinopsPeriod;
  category: FinopsCategory;
  status: 'complete' | 'partial';
  evidenceRef: string;
};
export type ActiveUsersEvidence = {
  period: FinopsPeriod;
  uniqueAuthenticatedUsers: number;
  status: 'complete' | 'partial';
  evidenceRef: string;
};
type Measure = {
  status: 'complete' | 'partial' | 'unavailable';
  confirmedMinor: number | null;
  estimatedMinor: number | null;
};

const fail = (reason: string): never => { throw new Error('FINOPS_' + reason); };
const nonEmpty = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0;
const validPeriod = (p: FinopsPeriod) => /^\d{4}-(0[1-9]|1[0-2])$/.test(p.month) &&
  p.timezone === 'America/Sao_Paulo' && p.currency === 'BRL' &&
  (p.basis === 'cash' || p.basis === 'accrual');
const samePeriod = (a: FinopsPeriod, b: FinopsPeriod) => validPeriod(b) &&
  a.month === b.month && a.timezone === b.timezone && a.currency === b.currency && a.basis === b.basis;
const add = (a: number, b: number) => {
  const result = a + b;
  if (!Number.isSafeInteger(result)) fail('AMOUNT_OVERFLOW');
  return result;
};
const sum = (amounts: number[]) => amounts.reduce(add, 0);
const safeRoundedRatio = (numerator: number, denominator: number, multiplier = 1): number | null => {
  if (denominator <= 0) return null;
  // Round half away from zero; integer math avoids multiplication overflow.
  const n = BigInt(numerator) * BigInt(multiplier);
  const d = BigInt(denominator);
  const magnitude = n < 0n ? -n : n;
  const rounded = (magnitude + d / 2n) / d;
  const result = Number(n < 0n ? -rounded : rounded);
  if (!Number.isSafeInteger(result)) fail('RATIO_OVERFLOW');
  return result;
};
const combine = (items: Measure[]): Measure => {
  const confirmed = items.flatMap(x => x.confirmedMinor === null ? [] : [x.confirmedMinor]);
  const estimated = items.flatMap(x => x.estimatedMinor === null ? [] : [x.estimatedMinor]);
  return {
    status: items.every(x => x.status === 'complete') ? 'complete' :
      items.some(x => x.status !== 'unavailable') ? 'partial' : 'unavailable',
    confirmedMinor: confirmed.length ? sum(confirmed) : null,
    estimatedMinor: estimated.length ? sum(estimated) : null,
  };
};

export function projectPlatformFinops(
  period: FinopsPeriod,
  facts: readonly FinopsFact[],
  coverage: readonly FinopsCoverage[],
  activeUsers?: ActiveUsersEvidence,
) {
  if (!validPeriod(period)) fail('PERIOD_INVALID');
  const ids = new Set<string>();
  const categorySet = new Set<string>(FINOPS_CATEGORIES);
  const grouped = new Map<FinopsCategory, FinopsFact[]>();
  const covered = new Map<FinopsCategory, FinopsCoverage>();
  for (const item of coverage) {
    if (!samePeriod(period, item.period) || !categorySet.has(item.category) ||
        !nonEmpty(item.evidenceRef) || !['complete', 'partial'].includes(item.status))
      fail('COVERAGE_INVALID');
    if (covered.has(item.category)) fail('DUPLICATE_COVERAGE');
    covered.set(item.category, item);
  }
  for (const fact of facts) {
    if (!samePeriod(period, fact.period) || !categorySet.has(fact.category) ||
        !nonEmpty(fact.factId) || !nonEmpty(fact.sourceRef) ||
        !Number.isSafeInteger(fact.amountMinor) || !['confirmed', 'estimated'].includes(fact.quality) ||
        !/^[A-Z]{3}$/.test(fact.originalCurrency) ||
        (fact.originalCurrency !== 'BRL' && !nonEmpty(fact.fxEvidenceRef)))
      fail('FACT_INVALID');
    if (ids.has(fact.factId)) fail('DUPLICATE_FACT');
    ids.add(fact.factId);
    const list = grouped.get(fact.category) ?? [];
    list.push(fact);
    grouped.set(fact.category, list);
  }
  const categories = Object.fromEntries(FINOPS_CATEGORIES.map(category => {
    const list = grouped.get(category) ?? [];
    const actual = list.filter(x => x.quality === 'confirmed');
    const estimated = list.filter(x => x.quality === 'estimated');
    const attestation = covered.get(category);
    const complete = attestation?.status === 'complete' && estimated.length === 0;
    const measure: Measure = {
      status: complete ? 'complete' : list.length || attestation ? 'partial' : 'unavailable',
      // Explicit complete coverage can confirm zero. Missing coverage cannot.
      confirmedMinor: actual.length || complete ? sum(actual.map(x => x.amountMinor)) : null,
      estimatedMinor: estimated.length ? sum(estimated.map(x => x.amountMinor)) : null,
    };
    return [category, measure];
  })) as Record<FinopsCategory, Measure>;
  const revenue = combine(OWN_REVENUE_CATEGORIES.map(c => categories[c]));
  const costs = combine(OWN_COST_CATEGORIES.map(c => categories[c]));
  let mau: number | null = null;
  if (activeUsers) {
    if (!samePeriod(period, activeUsers.period) || !nonEmpty(activeUsers.evidenceRef) ||
        !Number.isSafeInteger(activeUsers.uniqueAuthenticatedUsers) ||
        activeUsers.uniqueAuthenticatedUsers < 0 ||
        !['complete', 'partial'].includes(activeUsers.status)) fail('ACTIVE_USERS_INVALID');
    if (activeUsers.status === 'complete') mau = activeUsers.uniqueAuthenticatedUsers;
  }
  const fullRevenue = revenue.status === 'complete' ? revenue.confirmedMinor : null;
  const fullCosts = costs.status === 'complete' ? costs.confirmedMinor : null;
  const resultMinor = fullRevenue !== null && fullCosts !== null ? add(fullRevenue, -fullCosts) : null;
  return {
    period: {...period}, categories, revenue, costs,
    // Cash basis is net operating cash flow, not accounting profit.
    resultMinor,
    marginBps: resultMinor !== null && fullRevenue !== null ? safeRoundedRatio(resultMinor, fullRevenue, 10000) : null,
    mau,
    costPerActiveUserMinor: fullCosts !== null && mau !== null ? safeRoundedRatio(fullCosts, mau) : null,
    revenuePerActiveUserMinor: fullRevenue !== null && mau !== null ? safeRoundedRatio(fullRevenue, mau) : null,
    evidence: {
      coverage: coverage.map(x => ({...x, period: {...x.period}})),
      facts: facts.map(({factId, sourceRef, category, quality, originalCurrency, fxEvidenceRef}) =>
        ({factId, sourceRef, category, quality, originalCurrency, fxEvidenceRef})),
      activeUsers: activeUsers ? {...activeUsers, period: {...activeUsers.period}} : null,
    },
  };
}
