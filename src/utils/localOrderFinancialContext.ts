import type { LocalOrderFinancialContext } from '../../shared/localOrderFinancialContext';
import { auth } from './firebase';

const authorizedFetch = async (url: string): Promise<Response> => {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente para consultar o pagamento.');
  const token = await user.getIdToken();
  return fetch(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });
};

export const loadLocalOrderFinancialContext = async (input: {
  storeId: string;
  orderId: string;
}): Promise<LocalOrderFinancialContext> => {
  const params = new URLSearchParams({
    storeId: input.storeId,
    orderId: input.orderId,
  });
  const response = await authorizedFetch(
    `/api/local-attendance/financial-context?${params.toString()}`
  );
  const payload = await response.json().catch(() => ({})) as {
    context?: LocalOrderFinancialContext;
    error?: string;
  };
  if (!response.ok || !payload.context) {
    throw new Error(payload.error || 'Não foi possível consultar a evidência financeira do pedido.');
  }
  return payload.context;
};
