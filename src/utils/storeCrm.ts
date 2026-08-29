import type {
  StoreCrmCustomer,
  StoreCrmSegment,
  StoreCrmSummary,
} from '../../shared/storeCrm';
import { auth } from './firebase';

const SEGMENTS: readonly StoreCrmSegment[] = [
  'first_purchase',
  'recurring',
  'frequent',
  'loyal',
  'points_available',
  'challenge_engaged',
  'reward_redeemer',
] as const;

const parseCustomer = (value: unknown): StoreCrmCustomer | null => {
  if (!value || typeof value !== 'object') return null;
  const customer = value as Partial<StoreCrmCustomer>;
  if (
    typeof customer.customerId !== 'string' ||
    !customer.customerId.trim() ||
    typeof customer.name !== 'string' ||
    typeof customer.email !== 'string' ||
    typeof customer.avatarUrl !== 'string' ||
    !Number.isSafeInteger(customer.confirmedPurchases) ||
    Number(customer.confirmedPurchases) < 0 ||
    typeof customer.totalPaid !== 'number' ||
    !Number.isFinite(customer.totalPaid) ||
    typeof customer.averageTicket !== 'number' ||
    !Number.isFinite(customer.averageTicket) ||
    !Number.isSafeInteger(customer.pointsBalance) ||
    !customer.relationshipLevel ||
    !Array.isArray(customer.segments)
  ) {
    return null;
  }
  const segments = customer.segments.filter(
    (segment): segment is StoreCrmSegment =>
      SEGMENTS.includes(segment as StoreCrmSegment)
  );
  return { ...customer, segments } as StoreCrmCustomer;
};

export const loadStoreCrmForCurrentOwner = async (
  storeIdInput: string
): Promise<StoreCrmSummary> => {
  const storeId = storeIdInput.trim();
  const user = auth.currentUser;
  if (!user || !storeId || user.uid !== storeId) {
    throw new Error('Faça login novamente para consultar o CRM da sua loja.');
  }

  const token = await user.getIdToken();
  const response = await fetch(
    `/api/store-crm?storeId=${encodeURIComponent(storeId)}`,
    {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    }
  );
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string'
        ? payload.error
        : 'Não foi possível carregar o CRM da loja.'
    );
  }

  if (
    payload.schemaVersion !== 1 ||
    payload.storeId !== storeId ||
    !payload.totals ||
    typeof payload.totals !== 'object' ||
    !Array.isArray(payload.customers)
  ) {
    throw new Error('O CRM retornou uma resposta inválida.');
  }

  const customers = payload.customers.flatMap(value => {
    const customer = parseCustomer(value);
    return customer ? [customer] : [];
  });
  if (customers.length !== payload.customers.length) {
    throw new Error('O CRM retornou clientes com dados inválidos.');
  }

  return {
    schemaVersion: 1,
    storeId,
    generatedAt: typeof payload.generatedAt === 'string' ? payload.generatedAt : '',
    totals: payload.totals as StoreCrmSummary['totals'],
    customers,
  };
};
