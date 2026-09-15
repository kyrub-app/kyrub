import type { User } from 'firebase/auth';

export type StoreAdministrativeAuditDomain =
  | 'governance'
  | 'inventory'
  | 'orders'
  | 'integrations'
  | 'finance'
  | 'users'
  | 'ai'
  | 'store';

export interface StoreAdministrativeAuditEvent {
  id: string;
  tenantId: string;
  canonicalStoreId: string;
  domain: StoreAdministrativeAuditDomain;
  action: string;
  result: string;
  actorType: 'store_owner' | 'authorized_user' | 'integration' | 'kyrubia' | 'system';
  actorLabel: string;
  authority: string;
  subjectType: string;
  subjectId: string;
  reason: string;
  occurredAt: string;
  sourceKind: string;
  sourceRef: string;
  metadata: Record<string, string | number | boolean | null>;
}

export interface StoreAdministrativeAuditSnapshot {
  tenantId: string;
  canonicalStoreId: string;
  readAuthority: 'store_owner';
  items: StoreAdministrativeAuditEvent[];
  sourceWarnings: string[];
  generatedAt: string;
}

const encoded = (value: string): string => encodeURIComponent(value.trim());

export const loadStoreAdministrativeAudit = async (
  user: User,
  storeId: string,
  limit = 60
): Promise<StoreAdministrativeAuditSnapshot> => {
  const token = await user.getIdToken();
  const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  const response = await fetch(
    `/api/store-connections/${encoded(storeId)}/administrative-audit?limit=${boundedLimit}`,
    {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    }
  );
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof payload.error === 'string' && payload.error.trim()
      ? payload.error.trim()
      : `Não foi possível carregar a auditoria da loja (${response.status}).`;
    throw new Error(message);
  }
  return payload as unknown as StoreAdministrativeAuditSnapshot;
};
