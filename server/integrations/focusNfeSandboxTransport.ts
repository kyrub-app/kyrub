import { createHash } from 'node:crypto';
import type { FiscalHomologationDocumentFamily } from '../../shared/fiscalHomologationPolicy.js';
import type { FiscalProviderOutcome } from './fiscalProviderAdapter.js';

const FOCUS_HOMOLOGATION_BASE_URL = 'https://homologacao.focusnfe.com.br';
const FOCUS_API_PREFIX = '/v2';

const clean = (value: unknown, maxLength = 300): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const firstString = (...values: unknown[]): string => {
  for (const value of values) {
    const candidate = clean(value);
    if (candidate) return candidate;
  }
  return '';
};

const familyPath = (family: FiscalHomologationDocumentFamily): string => {
  if (family === 'nfe') return 'nfe';
  if (family === 'nfce') return 'nfce';
  if (family === 'nfse') return 'nfse';
  throw new Error('FOCUS_NFE_DOCUMENT_FAMILY_UNSUPPORTED');
};

const normalizedStatus = (payload: Record<string, unknown>): string =>
  firstString(
    payload.status,
    payload.status_sefaz,
    payload.status_prefeitura,
    payload.situacao
  ).toLocaleLowerCase('pt-BR').replace(/[\s-]+/g, '_');

const safeMessage = (payload: Record<string, unknown>, fallback: string): string => {
  const errors = Array.isArray(payload.erros) ? payload.erros : [];
  const firstError = errors.length > 0 ? record(errors[0]) : {};
  return firstString(
    payload.mensagem_sefaz,
    payload.mensagem,
    payload.message,
    payload.erro,
    firstError.mensagem,
    firstError.message,
    fallback
  ).slice(0, 300);
};

const safeCode = (payload: Record<string, unknown>): string | null => {
  const errors = Array.isArray(payload.erros) ? payload.erros : [];
  const firstError = errors.length > 0 ? record(errors[0]) : {};
  return firstString(
    payload.codigo,
    payload.codigo_sefaz,
    payload.code,
    firstError.codigo,
    firstError.code
  ).slice(0, 80) || null;
};

const externalFields = (payload: Record<string, unknown>) => ({
  authorizationProtocol: firstString(
    payload.protocolo,
    payload.protocolo_autorizacao,
    payload.numero_protocolo
  ).slice(0, 120) || null,
  accessKey: firstString(
    payload.chave_nfe,
    payload.chave_nfce,
    payload.chave_nfse,
    payload.chave
  ).slice(0, 80) || null,
  documentNumber: firstString(
    payload.numero,
    payload.numero_nfse,
    payload.numero_rps
  ).slice(0, 80) || null,
});

const statusMeansProcessing = (status: string): boolean =>
  status.includes('processando') ||
  status.includes('processamento') ||
  status === 'processing' ||
  status === 'pendente';

const statusMeansAuthorized = (status: string): boolean =>
  status === 'autorizado' ||
  status === 'autorizada' ||
  status === 'authorized';

const statusMeansRejected = (status: string): boolean =>
  status.includes('erro_autorizacao') ||
  status.includes('rejeitad') ||
  status.includes('denegad') ||
  status === 'rejected';

const bodySuggestsExistingReference = (payload: Record<string, unknown>): boolean => {
  const text = `${normalizedStatus(payload)} ${safeMessage(payload, '')}`.toLocaleLowerCase('pt-BR');
  return (
    text.includes('refer') &&
    (text.includes('utiliz') || text.includes('process') || text.includes('autoriza'))
  );
};

export const buildFocusNfeReference = (attemptId: string): string => {
  const normalizedAttemptId = clean(attemptId, 180);
  if (!/^fiscal-attempt-[a-f0-9]{48}$/.test(normalizedAttemptId)) {
    throw new Error('FOCUS_NFE_ATTEMPT_ID_INVALID');
  }
  // Focus accepts an alphanumeric caller-owned ref. Hashing removes Kyrub's
  // punctuation while preserving deterministic one-attempt/one-ref identity.
  return `kyrub${createHash('sha256')
    .update(normalizedAttemptId)
    .digest('hex')
    .slice(0, 48)}`;
};

export const buildFocusNfeBasicAuthorization = (token: string): string => {
  const normalizedToken = clean(token, 500);
  if (!normalizedToken) throw new Error('FOCUS_NFE_TOKEN_REQUIRED');
  return `Basic ${Buffer.from(`${normalizedToken}:`, 'utf8').toString('base64')}`;
};

export interface FocusNfeHttpResult {
  status: number;
  payload: Record<string, unknown>;
}

type FetchLike = (
  input: string,
  init?: RequestInit
) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

const parseJson = async (
  response: Pick<Response, 'json'>
): Promise<Record<string, unknown>> => {
  try {
    return record(await response.json());
  } catch {
    return {};
  }
};

const focusRequest = async (input: {
  method: 'GET' | 'POST';
  family: FiscalHomologationDocumentFamily;
  reference: string;
  token: string;
  payload?: Record<string, unknown>;
  fetchImpl?: FetchLike;
}): Promise<FocusNfeHttpResult> => {
  const family = familyPath(input.family);
  const ref = clean(input.reference, 80);
  if (!/^[A-Za-z0-9]+$/.test(ref)) throw new Error('FOCUS_NFE_REFERENCE_INVALID');
  const fetchImpl = input.fetchImpl ?? fetch;
  const path = input.method === 'POST'
    ? `${FOCUS_API_PREFIX}/${family}?ref=${encodeURIComponent(ref)}`
    : `${FOCUS_API_PREFIX}/${family}/${encodeURIComponent(ref)}`;
  const response = await fetchImpl(`${FOCUS_HOMOLOGATION_BASE_URL}${path}`, {
    method: input.method,
    headers: {
      authorization: buildFocusNfeBasicAuthorization(input.token),
      accept: 'application/json',
      ...(input.method === 'POST'
        ? { 'content-type': 'application/json; charset=utf-8' }
        : {}),
    },
    ...(input.method === 'POST'
      ? { body: JSON.stringify(input.payload ?? {}) }
      : {}),
  });
  return {
    status: response.status,
    payload: await parseJson(response),
  };
};

export const normalizeFocusNfeResult = (input: {
  operation: 'submit' | 'status';
  reference: string;
  httpStatus: number;
  payload: Record<string, unknown>;
}): FiscalProviderOutcome => {
  const status = normalizedStatus(input.payload);
  const providerStatus = status || `http_${input.httpStatus}`;

  if (input.httpStatus === 401 || input.httpStatus === 403) {
    return {
      kind: 'validation_failure',
      providerStatus,
      code: safeCode(input.payload) ?? `HTTP_${input.httpStatus}`,
      safeMessage: 'A credencial ou a autorização da Focus NFe não permite esta operação de homologação.',
    };
  }

  if (input.httpStatus >= 500) {
    return {
      kind: 'technical_ambiguity',
      externalRequestId: input.reference,
      providerStatus,
      safeMessage: 'A Focus NFe não confirmou de forma conclusiva o resultado da requisição.',
    };
  }

  if (statusMeansAuthorized(status)) {
    return {
      kind: 'authorized',
      externalRequestId: input.reference,
      providerStatus,
      ...externalFields(input.payload),
    };
  }

  if (statusMeansProcessing(status) || input.httpStatus === 202) {
    return {
      kind: 'processing',
      externalRequestId: input.reference,
      providerStatus,
    };
  }

  if (statusMeansRejected(status)) {
    return {
      kind: 'rejected',
      externalRequestId: input.reference,
      providerStatus,
      code: safeCode(input.payload),
      safeMessage: safeMessage(input.payload, 'O documento fiscal foi rejeitado em homologação.'),
    };
  }

  if (input.httpStatus === 404 && input.operation === 'status') {
    return {
      kind: 'technical_ambiguity',
      externalRequestId: input.reference,
      providerStatus,
      safeMessage: 'A referência ainda não foi localizada na consulta de homologação.',
    };
  }

  if ((input.httpStatus === 409 || input.httpStatus === 422) && bodySuggestsExistingReference(input.payload)) {
    return {
      kind: 'technical_ambiguity',
      externalRequestId: input.reference,
      providerStatus,
      safeMessage: 'A Focus NFe indicou que a referência já existe ou está em processamento; é necessário reconciliar por consulta.',
    };
  }

  if (input.httpStatus >= 400 && input.httpStatus < 500) {
    return {
      kind: 'validation_failure',
      providerStatus,
      code: safeCode(input.payload) ?? `HTTP_${input.httpStatus}`,
      safeMessage: safeMessage(input.payload, 'A Focus NFe recusou os dados antes da autorização.'),
    };
  }

  return {
    kind: 'technical_ambiguity',
    externalRequestId: input.reference,
    providerStatus,
    safeMessage: 'A resposta da Focus NFe não correspondeu a um estado fiscal conclusivo conhecido.',
  };
};

export const submitFocusNfeSandboxDocument = async (input: {
  family: FiscalHomologationDocumentFamily;
  attemptId: string;
  token: string;
  payload: Record<string, unknown>;
  fetchImpl?: FetchLike;
}): Promise<FiscalProviderOutcome> => {
  const reference = buildFocusNfeReference(input.attemptId);
  const response = await focusRequest({
    method: 'POST',
    family: input.family,
    reference,
    token: input.token,
    payload: input.payload,
    fetchImpl: input.fetchImpl,
  });
  return normalizeFocusNfeResult({
    operation: 'submit',
    reference,
    httpStatus: response.status,
    payload: response.payload,
  });
};

export const getFocusNfeSandboxDocumentStatus = async (input: {
  family: FiscalHomologationDocumentFamily;
  attemptId: string;
  token: string;
  fetchImpl?: FetchLike;
}): Promise<FiscalProviderOutcome> => {
  const reference = buildFocusNfeReference(input.attemptId);
  const response = await focusRequest({
    method: 'GET',
    family: input.family,
    reference,
    token: input.token,
    fetchImpl: input.fetchImpl,
  });
  return normalizeFocusNfeResult({
    operation: 'status',
    reference,
    httpStatus: response.status,
    payload: response.payload,
  });
};
