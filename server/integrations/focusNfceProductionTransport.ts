import type { FiscalProviderOutcome } from './fiscalProviderAdapter.js';
import {
  buildFocusNfeBasicAuthorization,
  buildFocusNfeReference,
  normalizeFocusNfeResult,
} from './focusNfeSandboxTransport.js';

const FOCUS_PRODUCTION_NFCE_URL = 'https://api.focusnfe.com.br/v2/nfce';

export interface FocusNfceProductionCapability {
  enabled: true;
  authority: 'server_owned_focus_nfce_production_capability';
  canonicalStoreId: string;
  authorizationId: string;
}

type FetchLike = (
  input: string,
  init?: RequestInit
) => Promise<Pick<Response, 'status' | 'json'>>;

const clean = (value: unknown, maxLength = 300): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const parseJson = async (response: Pick<Response, 'json'>): Promise<Record<string, unknown>> => {
  try {
    return record(await response.json());
  } catch {
    return {};
  }
};

const assertCapability = (input: {
  capability: FocusNfceProductionCapability | null | undefined;
  canonicalStoreId: string;
}): FocusNfceProductionCapability => {
  const capability = input.capability;
  if (
    !capability ||
    capability.enabled !== true ||
    capability.authority !== 'server_owned_focus_nfce_production_capability' ||
    clean(capability.canonicalStoreId, 160) !== clean(input.canonicalStoreId, 160) ||
    !clean(capability.authorizationId, 160)
  ) {
    throw new Error('FOCUS_NFCE_PRODUCTION_CAPABILITY_REQUIRED');
  }
  return capability;
};

/**
 * Internal Focus driver for Kyrub Fiscal. No route imports this transport.
 * Production traffic remains impossible unless a server-owned capability is
 * explicitly supplied by a future orchestrator after all fiscal gates pass.
 */
export const submitFocusNfceProductionDocument = async (input: {
  canonicalStoreId: string;
  attemptId: string;
  token: string;
  payload: Record<string, unknown>;
  capability?: FocusNfceProductionCapability | null;
  fetchImpl?: FetchLike;
}): Promise<FiscalProviderOutcome> => {
  assertCapability(input);
  const reference = buildFocusNfeReference(input.attemptId);
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(`${FOCUS_PRODUCTION_NFCE_URL}?ref=${encodeURIComponent(reference)}`, {
    method: 'POST',
    headers: {
      authorization: buildFocusNfeBasicAuthorization(input.token),
      accept: 'application/json',
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(input.payload),
  });
  return normalizeFocusNfeResult({
    operation: 'submit',
    reference,
    httpStatus: response.status,
    payload: await parseJson(response),
  });
};

export const getFocusNfceProductionDocumentStatus = async (input: {
  canonicalStoreId: string;
  attemptId: string;
  token: string;
  capability?: FocusNfceProductionCapability | null;
  fetchImpl?: FetchLike;
}): Promise<FiscalProviderOutcome> => {
  assertCapability(input);
  const reference = buildFocusNfeReference(input.attemptId);
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(`${FOCUS_PRODUCTION_NFCE_URL}/${encodeURIComponent(reference)}`, {
    method: 'GET',
    headers: {
      authorization: buildFocusNfeBasicAuthorization(input.token),
      accept: 'application/json',
    },
  });
  return normalizeFocusNfeResult({
    operation: 'status',
    reference,
    httpStatus: response.status,
    payload: await parseJson(response),
  });
};
