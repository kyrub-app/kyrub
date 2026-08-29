import type { User } from 'firebase/auth';
import type { StoreCrmSummary } from '../../shared/storeCrm';

export const loadStoreCrm = async (user: User, storeId: string): Promise<StoreCrmSummary> => {
  const token = await user.getIdToken();
  const response = await fetch(`/api/store-crm?storeId=${encodeURIComponent(storeId)}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const payload = await response.json() as StoreCrmSummary & { error?: string };
  if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar o CRM.');
  return payload;
};
