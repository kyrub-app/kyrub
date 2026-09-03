import type { User } from 'firebase/auth';

export type StoreInventoryAuthorityRepairAction =
  | 'link_existing_canonical_store'
  | 'activate_canonical_owner'
  | 'initialize_empty_inventory';

export type StoreInventoryAuthorityRepairReason =
  | 'canonical_link_missing'
  | 'authority_scope_mismatch'
  | 'multiple_active_owners'
  | 'canonical_owner_mismatch'
  | 'already_resolved';

export interface StoreInventoryAuthorityRepairPreview {
  state:
    | 'canonical_store_unresolved'
    | 'no_active_owner'
    | 'multiple_active_owners'
    | 'inventory_document_missing'
    | 'resolved';
  actionable: boolean;
  action: StoreInventoryAuthorityRepairAction | null;
  reason: StoreInventoryAuthorityRepairReason | null;
  repairId: string;
  activeOwnerCount: number;
  requiresConfirmation: boolean;
  checkedAt: string;
}

const authorizedRequest = async <T>(
  user: User,
  path: string,
  init: RequestInit = {}
): Promise<T> => {
  const token = await user.getIdToken();
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  if (init.body) headers.set('content-type', 'application/json');
  const response = await fetch(path, {
    ...init,
    headers,
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string' && payload.error.trim()
        ? payload.error.trim()
        : `Não foi possível revisar a autoridade do estoque (${response.status}).`
    );
  }
  return payload as T;
};

const repairPath = (storeId: string): string => {
  const normalizedStoreId = storeId.trim();
  if (!normalizedStoreId) throw new Error('Loja inválida para corrigir a autoridade do estoque.');
  return `/api/store-connections/${encodeURIComponent(normalizedStoreId)}/inventory-authority-repair`;
};

export const loadStoreInventoryAuthorityRepairPreview = async (
  user: User,
  storeId: string
): Promise<StoreInventoryAuthorityRepairPreview> =>
  authorizedRequest<StoreInventoryAuthorityRepairPreview>(
    user,
    repairPath(storeId),
    { method: 'GET' }
  );

export const confirmStoreInventoryAuthorityRepair = async (
  user: User,
  storeId: string,
  preview: StoreInventoryAuthorityRepairPreview
): Promise<{ action: StoreInventoryAuthorityRepairAction; repairId: string; applied: true }> => {
  if (
    !preview.actionable ||
    !preview.action ||
    !preview.requiresConfirmation ||
    !preview.repairId.trim()
  ) {
    throw new Error('Esta revisão não possui uma correção segura para confirmar.');
  }
  return authorizedRequest(
    user,
    repairPath(storeId),
    {
      method: 'POST',
      body: JSON.stringify({
        confirmed: true,
        repairId: preview.repairId,
      }),
    }
  );
};
