export const KYRUBIA_DEFAULT_PRIMARY_MODEL = 'gemini-3.6-flash';
export const KYRUBIA_DEFAULT_ECONOMY_MODEL = 'gemini-3.5-flash-lite';

export type KyrubiaModelRoute = 'primary' | 'economy';

export type KyrubiaModelSelection = {
  preferredModel: string;
  fallbackModel: string;
  route: KyrubiaModelRoute;
};

export type GeminiQuotaDiagnostic = {
  status: string;
  message: string;
  quotaMetrics: string[];
  quotaIds: string[];
  retryDelay: string;
};

const SIMPLE_MULTIMODAL_INTENT = /(?:\bo\s+que\s+(?:aparece|tem|h[aá])\b|\bdescrev(?:a|er)\b|\bidentifi(?:que|car)\b|\blei(?:a|tura)\b|\btranscrev(?:a|er)\b|\bextrai(?:a|r)\b|\blist(?:e|ar)\b|\bresum(?:a|ir)\b|\bconte\b|\bmostre\b|\bqual\s+(?:[ée]|o|a)\b|\bquais\b|\btexto\b[^\n]{0,40}\bimagem\b|\bimagem\b[^\n]{0,40}\btexto\b)/i;

const COMPLEX_MULTIMODAL_INTENT = /\b(?:estrat[eé]gi|planej|prioriz|trade[- ]?off|arquitet|jur[ií]dic|financeir|diagn[oó]stic|raciocin|decis[aã]o|oportunidade|monetiz|otimiz|recomend|compare|comparar|aprofund|c[oó]digo|codigo)\b/i;

const cleanModel = (value: string | undefined, fallback: string): string =>
  value?.trim() || fallback;

export const shouldPreferEconomyModel = (
  latestUserText: string,
  hasMultimodalContext: boolean
): boolean => {
  if (!hasMultimodalContext) return false;
  const text = latestUserText.trim();
  if (!text || COMPLEX_MULTIMODAL_INTENT.test(text)) return false;
  return SIMPLE_MULTIMODAL_INTENT.test(text);
};

export const selectKyrubiaGeminiModel = (input: {
  latestUserText: string;
  hasMultimodalContext: boolean;
  primaryModel?: string;
  economyModel?: string;
}): KyrubiaModelSelection => {
  const primaryModel = cleanModel(
    input.primaryModel,
    KYRUBIA_DEFAULT_PRIMARY_MODEL
  );
  const economyModel = cleanModel(
    input.economyModel,
    KYRUBIA_DEFAULT_ECONOMY_MODEL
  );
  const useEconomy = shouldPreferEconomyModel(
    input.latestUserText,
    input.hasMultimodalContext
  );

  return useEconomy
    ? {
        preferredModel: economyModel,
        fallbackModel: primaryModel,
        route: 'economy',
      }
    : {
        preferredModel: primaryModel,
        fallbackModel: economyModel,
        route: 'primary',
      };
};

export const alternateGeminiModel = (
  activeModel: string,
  selection: KyrubiaModelSelection
): string => activeModel === selection.preferredModel
  ? selection.fallbackModel
  : selection.preferredModel;

export const isGeminiQuotaErrorCode = (code: unknown): boolean =>
  code === 'AI_QUOTA_EXCEEDED';

const recordValue = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const shortText = (value: unknown, maximum: number): string =>
  typeof value === 'string' ? value.trim().slice(0, maximum) : '';

const unique = (values: string[]): string[] => Array.from(new Set(values));

export const extractGeminiQuotaDiagnostic = (
  payload: Record<string, unknown>
): GeminiQuotaDiagnostic => {
  const error = recordValue(payload.error) ?? {};
  const details = Array.isArray(error.details) ? error.details : [];
  const quotaMetrics: string[] = [];
  const quotaIds: string[] = [];
  let retryDelay = '';

  for (const rawDetail of details) {
    const detail = recordValue(rawDetail);
    if (!detail) continue;

    const detailRetryDelay = shortText(detail.retryDelay, 80);
    if (detailRetryDelay && !retryDelay) retryDelay = detailRetryDelay;

    const violations = Array.isArray(detail.violations)
      ? detail.violations
      : [];
    for (const rawViolation of violations) {
      const violation = recordValue(rawViolation);
      if (!violation) continue;
      const metric = shortText(violation.quotaMetric, 240);
      const quotaId = shortText(violation.quotaId, 240);
      if (metric) quotaMetrics.push(metric);
      if (quotaId) quotaIds.push(quotaId);
    }
  }

  return {
    status: shortText(error.status, 80),
    message: shortText(error.message, 500),
    quotaMetrics: unique(quotaMetrics).slice(0, 8),
    quotaIds: unique(quotaIds).slice(0, 8),
    retryDelay,
  };
};
