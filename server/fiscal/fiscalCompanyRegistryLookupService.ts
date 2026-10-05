import { Buffer } from 'node:buffer';
import { FieldValue } from 'firebase-admin/firestore';
import {
  SERPRO_CNPJ_BASIC_ENDPOINT,
  SERPRO_CNPJ_TOKEN_ENDPOINT,
  assertSerproCnpjCredentials,
  type SerproCnpjBasicLookupView,
} from '../../shared/serproCnpjIntegration.js';
import { adminDb } from '../firebaseAdmin.js';
import { resolvePlatformCredentials } from '../integrations/platformCredentialStore.js';
import { authorizeOwnFiscalStore } from './fiscalStoreAuthorization.js';

const clean = (value: unknown, maxLength = 240): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
const digits = (value: unknown): string => clean(value, 40).replace(/\D/g, '');
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const isValidCnpj = (value: string): boolean => {
  if (!/^\d{14}$/.test(value) || /^(\d)\1{13}$/.test(value)) return false;
  const calculate = (base: string, weights: number[]): number => {
    const sum = base.split('').reduce(
      (total, digit, index) => total + Number(digit) * weights[index],
      0
    );
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  const first = calculate(value.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = calculate(value.slice(0, 12) + first, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return value.endsWith(`${first}${second}`);
};

const fetchWithTimeout = async (
  url: string,
  init: RequestInit,
  timeoutMs = 10_000
): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const requestBearerToken = async (): Promise<string> => {
  const stored = await resolvePlatformCredentials('serpro_cnpj', 'production');
  if (!stored) throw new Error('SERPRO_CNPJ_NOT_CONFIGURED');
  const credentials = assertSerproCnpjCredentials({
    consumerKey: stored.consumer_key,
    consumerSecret: stored.consumer_secret,
  });
  const authorization = Buffer.from(
    `${credentials.consumerKey}:${credentials.consumerSecret}`,
    'utf8'
  ).toString('base64');
  const response = await fetchWithTimeout(SERPRO_CNPJ_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: `Basic ${authorization}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  const token = clean(payload.access_token, 8192);
  if (!response.ok || !token) {
    if (response.status === 401 || response.status === 403) throw new Error('SERPRO_CNPJ_AUTH_FAILED');
    if (response.status === 429) throw new Error('SERPRO_CNPJ_RATE_LIMITED');
    throw new Error('SERPRO_CNPJ_TOKEN_UNAVAILABLE');
  }
  return token;
};

const normalizeBasicResponse = (
  cnpj: string,
  payload: Record<string, unknown>
): SerproCnpjBasicLookupView => {
  const status = record(payload.situacaoCadastral);
  const cnae = record(payload.cnaePrincipal);
  const address = record(payload.endereco);
  const municipality = record(address.municipio);
  const streetType = clean(address.tipoLogradouro, 40);
  const streetName = clean(address.logradouro, 160);
  const street = [streetType, streetName].filter(Boolean).join(' ').trim();
  return {
    source: 'serpro_cnpj',
    lookedUpAt: new Date().toISOString(),
    cnpj: digits(payload.ni) || cnpj,
    legalName: clean(payload.nomeEmpresarial, 180),
    tradeName: clean(payload.nomeFantasia, 180),
    registrationStatus: {
      code: clean(status.codigo, 40),
      date: clean(status.data, 40),
      reason: clean(status.motivo, 180),
    },
    primaryCnae: {
      code: clean(cnae.codigo, 20),
      description: clean(cnae.descricao, 240),
    },
    address: {
      street,
      number: clean(address.numero, 30),
      complement: clean(address.complemento, 80),
      district: clean(address.bairro, 100),
      city: clean(municipality.descricao, 100),
      state: clean(address.uf, 2).toUpperCase(),
      postalCode: digits(address.cep).slice(0, 8),
      ibgeCityCode: digits(municipality.codigo).slice(0, 7),
    },
  };
};

export const lookupOwnFiscalCompanyRegistry = async (input: {
  authorization: string;
  canonicalStoreId: unknown;
  cnpj: unknown;
}): Promise<SerproCnpjBasicLookupView> => {
  const authorized = await authorizeOwnFiscalStore({
    authorization: input.authorization,
    canonicalStoreId: input.canonicalStoreId,
    storeRequiredCode: 'FISCAL_COMPANY_LOOKUP_INPUT_REQUIRED',
  });
  const cnpj = digits(input.cnpj);
  if (!isValidCnpj(cnpj)) throw new Error('FISCAL_CNPJ_INVALID');

  const token = await requestBearerToken();
  const response = await fetchWithTimeout(
    `${SERPRO_CNPJ_BASIC_ENDPOINT}/${encodeURIComponent(cnpj)}`,
    {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        'x-request-tag': 'kyrub-fiscal-cnpj',
      },
    }
  );
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;

  if (response.status === 404) throw new Error('SERPRO_CNPJ_NOT_FOUND');
  if (response.status === 400) throw new Error('FISCAL_CNPJ_INVALID');
  if (response.status === 401 || response.status === 403) throw new Error('SERPRO_CNPJ_QUERY_NOT_AUTHORIZED');
  if (response.status === 429) throw new Error('SERPRO_CNPJ_RATE_LIMITED');
  if (!response.ok && response.status !== 206) throw new Error('SERPRO_CNPJ_QUERY_UNAVAILABLE');

  const result = normalizeBasicResponse(cnpj, payload);
  if (!result.legalName) throw new Error('SERPRO_CNPJ_RESPONSE_INVALID');

  const auditId = crypto.randomUUID().replaceAll('-', '_');
  await adminDb.doc(`kyrub_admin/control_plane/audit_logs/${auditId}`).set({
    id: auditId,
    action: 'store.fiscal.company_registry.looked_up',
    actorId: authorized.actorId,
    actorRole: 'store_owner',
    targetType: 'store',
    targetId: authorized.canonicalStoreId,
    provider: 'serpro_cnpj',
    cnpjLast4: cnpj.slice(-4),
    source: 'server',
    createdAt: FieldValue.serverTimestamp(),
  });
  return result;
};

export const mapFiscalCompanyRegistryLookupError = (
  error: unknown
): { status: number; body: { error: string; code: string } } => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'AUTH_REQUIRED' || /id-token|expired|revoked/i.test(message)) {
    return { status: 401, body: { error: 'Faça login novamente.', code: 'AUTH_REQUIRED' } };
  }
  if (message === 'EMAIL_NOT_VERIFIED' || message === 'FISCAL_STORE_OWNERSHIP_REQUIRED') {
    return { status: 403, body: { error: 'Você não pode consultar dados empresariais para esta loja.', code: message } };
  }
  if (message === 'FISCAL_STORE_NOT_FOUND') {
    return { status: 404, body: { error: 'A loja autenticada não foi encontrada.', code: message } };
  }
  if (message === 'FISCAL_STORE_IDENTITY_INVALID') {
    return { status: 409, body: { error: 'A identidade canônica da loja está inconsistente.', code: message } };
  }
  if (message === 'FISCAL_CNPJ_INVALID') {
    return { status: 400, body: { error: 'Informe um CNPJ válido.', code: message } };
  }
  if (message === 'SERPRO_CNPJ_NOT_FOUND') {
    return { status: 404, body: { error: 'O SERPRO não encontrou esse CNPJ na consulta cadastral.', code: message } };
  }
  if (message === 'SERPRO_CNPJ_NOT_CONFIGURED') {
    return { status: 503, body: { error: 'A consulta oficial de CNPJ ainda não está configurada pelo Kyrub.', code: message } };
  }
  if (message === 'SERPRO_CNPJ_AUTH_FAILED' || message === 'SERPRO_CNPJ_QUERY_NOT_AUTHORIZED') {
    return { status: 503, body: { error: 'A integração oficial de CNPJ precisa ser validada pelo administrador do Kyrub.', code: message } };
  }
  if (message === 'SERPRO_CNPJ_RATE_LIMITED') {
    return { status: 429, body: { error: 'O serviço oficial limitou temporariamente as consultas. Tente novamente em instantes.', code: message } };
  }
  if (message === 'SERPRO_CNPJ_TOKEN_UNAVAILABLE' || message === 'SERPRO_CNPJ_QUERY_UNAVAILABLE' || message === 'SERPRO_CNPJ_RESPONSE_INVALID') {
    return { status: 503, body: { error: 'A consulta oficial de CNPJ está temporariamente indisponível.', code: message } };
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return { status: 504, body: { error: 'A consulta oficial de CNPJ demorou mais do que o esperado.', code: 'SERPRO_CNPJ_TIMEOUT' } };
  }
  console.error('[Fiscal Company Registry Lookup]', error);
  return { status: 503, body: { error: 'Não foi possível consultar os dados da empresa agora.', code: 'FISCAL_COMPANY_LOOKUP_FAILED' } };
};
