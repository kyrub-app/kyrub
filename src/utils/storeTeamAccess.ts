import type { User } from 'firebase/auth';

export type StoreTeamRole =
  | 'owner'
  | 'manager'
  | 'cashier'
  | 'seller'
  | 'production';

export type StoreTeamMembershipStatus =
  | 'invited'
  | 'active'
  | 'suspended'
  | 'removed';

export interface StoreTeamMemberProjection {
  memberRef: string;
  displayName: string;
  maskedEmail: string;
  role: StoreTeamRole;
  status: StoreTeamMembershipStatus;
  isCanonicalOwner: boolean;
  createdAt: string;
  invitedAt: string;
  acceptedAt: string;
  suspendedAt: string;
  removedAt: string;
  updatedAt: string;
  authoritySource: 'canonical_store_membership';
}

export interface StoreTeamAccessSnapshot {
  tenantId: string;
  canonicalStoreId: string;
  readAuthority: 'store_owner';
  members: StoreTeamMemberProjection[];
  sourceWarnings: string[];
  generatedAt: string;
}

const encoded = (value: string): string => encodeURIComponent(value.trim());

export const loadStoreTeamAccess = async (
  user: User,
  storeId: string
): Promise<StoreTeamAccessSnapshot> => {
  const token = await user.getIdToken();
  const response = await fetch(
    `/api/store-connections/${encoded(storeId)}/team-access`,
    {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    }
  );
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof payload.error === 'string' && payload.error.trim()
      ? payload.error.trim()
      : `Não foi possível carregar a equipe da loja (${response.status}).`;
    throw new Error(message);
  }
  return payload as unknown as StoreTeamAccessSnapshot;
};
