import { auth } from './firebase';

export interface FiscalConsumerIdentitySummary {
  status: 'identified';
  identifierKind: 'cpf' | 'cnpj';
  maskedTaxIdentifier: string;
  capturedAt: string;
}

export interface FiscalConsumerIdentitySelectionResult {
  status: 'none' | 'uniform' | 'mixed';
  orderIds: string[];
  identity: FiscalConsumerIdentitySummary | null;
}

const currentUser = () => {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente para informar o documento fiscal.');
  return user;
};

const request = async (
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Record<string, unknown>> => {
  const token = await currentUser().getIdToken();
  const response = await fetch(input, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
      authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string' && payload.error.trim()
        ? payload.error.trim()
        : 'Não foi possível atualizar a identificação fiscal do consumidor.'
    );
  }
  return payload;
};

const parseResult = (value: unknown): FiscalConsumerIdentitySelectionResult => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('O servidor retornou uma identificação fiscal incompatível.');
  }
  const raw = value as Record<string, unknown>;
  if (
    raw.status !== 'none' &&
    raw.status !== 'uniform' &&
    raw.status !== 'mixed'
  ) {
    throw new Error('O servidor retornou uma identificação fiscal incompatível.');
  }
  const orderIds = Array.isArray(raw.orderIds)
    ? raw.orderIds.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    : [];
  let identity: FiscalConsumerIdentitySummary | null = null;
  if (raw.identity && typeof raw.identity === 'object' && !Array.isArray(raw.identity)) {
    const candidate = raw.identity as Record<string, unknown>;
    if (
      candidate.status !== 'identified' ||
      (candidate.identifierKind !== 'cpf' && candidate.identifierKind !== 'cnpj') ||
      typeof candidate.maskedTaxIdentifier !== 'string' ||
      !candidate.maskedTaxIdentifier.trim() ||
      typeof candidate.capturedAt !== 'string' ||
      !Number.isFinite(Date.parse(candidate.capturedAt))
    ) {
      throw new Error('O servidor retornou uma identificação fiscal incompatível.');
    }
    identity = {
      status: 'identified',
      identifierKind: candidate.identifierKind,
      maskedTaxIdentifier: candidate.maskedTaxIdentifier.trim(),
      capturedAt: candidate.capturedAt,
    };
  }
  if ((raw.status === 'uniform') !== Boolean(identity)) {
    throw new Error('O servidor retornou uma identificação fiscal incompatível.');
  }
  return { status: raw.status, orderIds, identity };
};

export const loadFiscalConsumerIdentity = async (input: {
  storeId: string;
  orderIds: string[];
}): Promise<FiscalConsumerIdentitySelectionResult> => {
  const storeId = input.storeId.trim();
  const orderIds = Array.from(new Set(input.orderIds.map(item => item.trim()).filter(Boolean)));
  if (!storeId || orderIds.length === 0) {
    return { status: 'none', orderIds, identity: null };
  }
  const query = new URLSearchParams({ storeId, orderIds: orderIds.join(',') });
  const payload = await request(`/api/local-attendance/orders/fiscal-consumer-identity?${query.toString()}`);
  return parseResult(payload.fiscalConsumerIdentity);
};

export const saveFiscalConsumerIdentity = async (input: {
  storeId: string;
  orderIds: string[];
  taxIdentifier: string;
}): Promise<FiscalConsumerIdentitySelectionResult> => {
  const payload = await request('/api/local-attendance/orders/fiscal-consumer-identity', {
    method: 'PUT',
    body: JSON.stringify({
      storeId: input.storeId.trim(),
      orderIds: Array.from(new Set(input.orderIds.map(item => item.trim()).filter(Boolean))),
      taxIdentifier: input.taxIdentifier,
    }),
  });
  return parseResult(payload.fiscalConsumerIdentity);
};
