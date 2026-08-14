export type KyrubiaUsageModality = {
  modality: string;
  tokenCount: number;
};

export type KyrubiaUsageSnapshot = {
  promptTokenCount: number;
  cachedContentTokenCount: number;
  candidatesTokenCount: number;
  toolUsePromptTokenCount: number;
  thoughtsTokenCount: number;
  totalTokenCount: number;
  promptTokensDetails: KyrubiaUsageModality[];
  cacheTokensDetails: KyrubiaUsageModality[];
  candidatesTokensDetails: KyrubiaUsageModality[];
  toolUsePromptTokensDetails: KyrubiaUsageModality[];
  serviceTier: string;
};

export type KyrubiaProviderPricingSnapshot = {
  provider: 'google-gemini';
  model: string;
  serviceTier: 'standard';
  currency: 'USD';
  unit: 'per_1m_tokens';
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  effectiveFrom: string;
  source: string;
};

export type KyrubiaUsageCost = {
  estimatedCostMicrousd: number | null;
  pricingStatus: 'priced' | 'unknown_model' | 'unsupported_service_tier' | 'cached_usage_unpriced';
  pricing: KyrubiaProviderPricingSnapshot | null;
};

const GEMINI_STANDARD_PRICING: Record<string, KyrubiaProviderPricingSnapshot> = {
  'gemini-3.6-flash': {
    provider: 'google-gemini',
    model: 'gemini-3.6-flash',
    serviceTier: 'standard',
    currency: 'USD',
    unit: 'per_1m_tokens',
    inputUsdPerMillion: 1.5,
    outputUsdPerMillion: 7.5,
    effectiveFrom: '2026-07-21',
    source: 'Google AI for Developers — Latest Gemini models / pricing',
  },
  'gemini-3.5-flash-lite': {
    provider: 'google-gemini',
    model: 'gemini-3.5-flash-lite',
    serviceTier: 'standard',
    currency: 'USD',
    unit: 'per_1m_tokens',
    inputUsdPerMillion: 0.3,
    outputUsdPerMillion: 2.5,
    effectiveFrom: '2026-07-21',
    source: 'Google AI for Developers — Latest Gemini models / pricing',
  },
};

const nonNegativeInteger = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : 0;

const cleanString = (value: unknown): string =>
  typeof value === 'string' ? value.trim().slice(0, 120) : '';

const parseModalityDetails = (value: unknown): KyrubiaUsageModality[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Record<string, unknown>;
    const modality = cleanString(candidate.modality).toUpperCase();
    const tokenCount = nonNegativeInteger(candidate.tokenCount);
    return modality ? [{ modality, tokenCount }] : [];
  });
};

export const parseGeminiUsageMetadata = (
  payload: Record<string, unknown>
): KyrubiaUsageSnapshot | null => {
  const value = payload.usageMetadata;
  if (!value || typeof value !== 'object') return null;
  const usage = value as Record<string, unknown>;

  const snapshot: KyrubiaUsageSnapshot = {
    promptTokenCount: nonNegativeInteger(usage.promptTokenCount),
    cachedContentTokenCount: nonNegativeInteger(usage.cachedContentTokenCount),
    candidatesTokenCount: nonNegativeInteger(usage.candidatesTokenCount),
    toolUsePromptTokenCount: nonNegativeInteger(usage.toolUsePromptTokenCount),
    thoughtsTokenCount: nonNegativeInteger(usage.thoughtsTokenCount),
    totalTokenCount: nonNegativeInteger(usage.totalTokenCount),
    promptTokensDetails: parseModalityDetails(usage.promptTokensDetails),
    cacheTokensDetails: parseModalityDetails(usage.cacheTokensDetails),
    candidatesTokensDetails: parseModalityDetails(usage.candidatesTokensDetails),
    toolUsePromptTokensDetails: parseModalityDetails(usage.toolUsePromptTokensDetails),
    serviceTier: cleanString(usage.serviceTier).toUpperCase(),
  };

  const hasUsage = snapshot.totalTokenCount > 0 ||
    snapshot.promptTokenCount > 0 ||
    snapshot.candidatesTokenCount > 0 ||
    snapshot.thoughtsTokenCount > 0;
  return hasUsage ? snapshot : null;
};

export const getGeminiStandardPricing = (
  model: string
): KyrubiaProviderPricingSnapshot | null =>
  GEMINI_STANDARD_PRICING[model.trim()] ?? null;

export const estimateGeminiUsageCost = (
  model: string,
  usage: KyrubiaUsageSnapshot
): KyrubiaUsageCost => {
  const pricing = getGeminiStandardPricing(model);
  if (!pricing) {
    return {
      estimatedCostMicrousd: null,
      pricingStatus: 'unknown_model',
      pricing: null,
    };
  }

  const serviceTier = usage.serviceTier;
  if (serviceTier && serviceTier !== 'STANDARD' && serviceTier !== 'SERVICE_TIER_UNSPECIFIED') {
    return {
      estimatedCostMicrousd: null,
      pricingStatus: 'unsupported_service_tier',
      pricing,
    };
  }

  // Context caching has its own price. The current Kyrubia route does not enable
  // cachedContent; if that changes, do not silently over/understate the bill.
  if (usage.cachedContentTokenCount > 0) {
    return {
      estimatedCostMicrousd: null,
      pricingStatus: 'cached_usage_unpriced',
      pricing,
    };
  }

  // USD cost = tokens * USD-per-million / 1,000,000.
  // Multiplying that value by 1,000,000 yields integer micro-USD directly.
  const outputAndThinkingTokens =
    usage.candidatesTokenCount + usage.thoughtsTokenCount;
  const estimatedCostMicrousd = Math.max(
    0,
    Math.round(
      usage.promptTokenCount * pricing.inputUsdPerMillion +
      outputAndThinkingTokens * pricing.outputUsdPerMillion
    )
  );

  return {
    estimatedCostMicrousd,
    pricingStatus: 'priced',
    pricing,
  };
};
