export type KyrubiaProviderOutcome = 'success' | 'failure';

export type KyrubiaProviderFailureClass =
  | 'quota'
  | 'timeout'
  | 'provider_5xx'
  | 'provider_4xx'
  | 'tool_call'
  | 'auth'
  | 'network'
  | 'internal'
  | 'unknown';

export type KyrubiaProviderDiagnostic = {
  outcome: KyrubiaProviderOutcome;
  failureClass: KyrubiaProviderFailureClass | null;
  httpStatus: number | null;
  providerStatus: string;
  providerCode: string;
  retryable: boolean;
  retryDelay: string;
  quotaMetrics: string[];
  quotaIds: string[];
};

type DiagnosticInput = {
  httpStatus?: unknown;
  providerStatus?: unknown;
  providerCode?: unknown;
  message?: unknown;
  aborted?: unknown;
  networkFailure?: unknown;
  toolCallFailure?: unknown;
  retryDelay?: unknown;
  quotaMetrics?: unknown;
  quotaIds?: unknown;
};

const cleanText = (value: unknown, maximum = 240): string =>
  typeof value === 'string' ? value.trim().slice(0, maximum) : '';

const cleanList = (value: unknown): string[] =>
  Array.isArray(value)
    ? Array.from(new Set(value.map(item => cleanText(item, 240)).filter(Boolean))).slice(0, 8)
    : [];

const statusNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : null;

export const classifyKyrubiaProviderDiagnostic = (
  input: DiagnosticInput
): KyrubiaProviderDiagnostic => {
  const httpStatus = statusNumber(input.httpStatus);
  const providerStatus = cleanText(input.providerStatus, 80).toUpperCase();
  const providerCode = cleanText(input.providerCode, 120).toUpperCase();
  const message = cleanText(input.message, 500).toLowerCase();
  const retryDelay = cleanText(input.retryDelay, 80);
  const quotaMetrics = cleanList(input.quotaMetrics);
  const quotaIds = cleanList(input.quotaIds);

  const success = httpStatus !== null && httpStatus >= 200 && httpStatus < 300;
  if (success) {
    return {
      outcome: 'success',
      failureClass: null,
      httpStatus,
      providerStatus,
      providerCode,
      retryable: false,
      retryDelay: '',
      quotaMetrics: [],
      quotaIds: [],
    };
  }

  const quota =
    httpStatus === 429 ||
    providerStatus === 'RESOURCE_EXHAUSTED' ||
    providerCode === 'AI_QUOTA_EXCEEDED' ||
    quotaMetrics.length > 0 ||
    quotaIds.length > 0 ||
    /quota|rate limit|resource exhausted|too many requests/.test(message);

  let failureClass: KyrubiaProviderFailureClass = 'unknown';
  if (input.aborted === true || /abort|timed? out|timeout/.test(message)) {
    failureClass = 'timeout';
  } else if (quota) {
    failureClass = 'quota';
  } else if (input.toolCallFailure === true || /thought_signature|function call|tool call/.test(message)) {
    failureClass = 'tool_call';
  } else if (httpStatus === 401 || httpStatus === 403) {
    failureClass = 'auth';
  } else if (httpStatus !== null && httpStatus >= 500) {
    failureClass = 'provider_5xx';
  } else if (httpStatus !== null && httpStatus >= 400) {
    failureClass = 'provider_4xx';
  } else if (input.networkFailure === true) {
    failureClass = 'network';
  } else if (/internal|unexpected|invariant/.test(message)) {
    failureClass = 'internal';
  }

  const retryable =
    failureClass === 'quota' ||
    failureClass === 'timeout' ||
    failureClass === 'provider_5xx' ||
    failureClass === 'network';

  return {
    outcome: 'failure',
    failureClass,
    httpStatus,
    providerStatus,
    providerCode,
    retryable,
    retryDelay,
    quotaMetrics,
    quotaIds,
  };
};
