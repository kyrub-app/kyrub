import type { User } from 'firebase/auth';

export interface StoreInventoryAuthorityHealth {
  state:
    | 'canonical_store_unresolved'
    | 'resolved'
    | 'no_active_owner'
    | 'canonical_owner_not_active'
    | 'multiple_active_owners'
    | 'inventory_document_missing';
  activeOwnerCount: number;
  inventoryDocumentExists: boolean;
  checkedAt: string;
}

export const loadStoreInventoryAuthorityHealth = async (
  user: User,
  storeId: string
): Promise<StoreInventoryAuthorityHealth> => {
  const normalizedStoreId = storeId.trim();
  if (!normalizedStoreId) throw new Error('Loja inválida para verificar a autoridade do estoque.');
  const token = await user.getIdToken();
  const response = await fetch(
    `/api/store-connections/${encodeURIComponent(normalizedStoreId)}/inventory-authority-health`,
    {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    }
  );
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string' && payload.error.trim()
        ? payload.error.trim()
        : `Não foi possível verificar a autoridade do estoque (${response.status}).`
    );
  }
  return payload as unknown as StoreInventoryAuthorityHealth;
};
