import type { User } from 'firebase/auth';

export interface StoreOwnerGovernanceCandidate {
  selectionId: string;
  displayName: string;
  emailHint: string;
  selectable: boolean;
}

export interface StoreOwnerGovernancePreview {
  state:
    | 'no_conflict'
    | 'multiple_active_owners'
    | 'canonical_owner_not_active'
    | 'authority_scope_mismatch';
  actionable: boolean;
  conflictId: string;
  activeOwnerCount: number;
  canonicalOwnerProtected: boolean;
  canonicalOwnerActivationId: string;
  candidates: StoreOwnerGovernanceCandidate[];
  requiresConfirmation: boolean;
  checkedAt: string;
}

const responseError = async (response: Response, fallback: string): Promise<Error> => {
  try {
    const payload = await response.json() as { error?: unknown };
    if (typeof payload.error === 'string' && payload.error.trim()) {
      return new Error(payload.error.trim());
    }
  } catch {
    // Ignore invalid error bodies and use the stable fallback below.
  }
  return new Error(fallback);
};

export const loadStoreOwnerGovernancePreview = async (
  user: User,
  storeId: string
): Promise<StoreOwnerGovernancePreview> => {
  const normalizedStoreId = storeId.trim();
  if (!normalizedStoreId) throw new Error('Loja inválida para revisar ownership.');
  const token = await user.getIdToken();
  const response = await fetch(
    `/api/store-connections/${encodeURIComponent(normalizedStoreId)}/owner-governance`,
    {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    }
  );
  if (!response.ok) {
    throw await responseError(response, 'Não foi possível revisar os owners da loja.');
  }
  return response.json() as Promise<StoreOwnerGovernancePreview>;
};

export const confirmCanonicalOwnerReconciliation = async (
  user: User,
  storeId: string,
  preview: StoreOwnerGovernancePreview
): Promise<void> => {
  const normalizedStoreId = storeId.trim();
  if (
    !normalizedStoreId ||
    !preview.conflictId ||
    !preview.canonicalOwnerActivationId ||
    preview.state !== 'canonical_owner_not_active'
  ) {
    throw new Error('A revisão do owner canônico está incompleta ou expirou.');
  }
  const token = await user.getIdToken();
  const response = await fetch(
    `/api/store-connections/${encodeURIComponent(normalizedStoreId)}/owner-governance/reconcile-canonical-owner`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      cache: 'no-store',
      body: JSON.stringify({
        conflictId: preview.conflictId,
        activationId: preview.canonicalOwnerActivationId,
        confirmed: true,
      }),
    }
  );
  if (!response.ok) {
    throw await responseError(response, 'Não foi possível ativar a membership do owner canônico.');
  }
};

export const confirmStoreOwnerGovernanceDecision = async (
  user: User,
  storeId: string,
  preview: StoreOwnerGovernancePreview,
  candidate: StoreOwnerGovernanceCandidate
): Promise<void> => {
  const normalizedStoreId = storeId.trim();
  if (!normalizedStoreId || !preview.conflictId || !candidate.selectionId) {
    throw new Error('A revisão de ownership está incompleta ou expirou.');
  }
  const token = await user.getIdToken();
  const response = await fetch(
    `/api/store-connections/${encodeURIComponent(normalizedStoreId)}/owner-governance`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      cache: 'no-store',
      body: JSON.stringify({
        conflictId: preview.conflictId,
        selectionId: candidate.selectionId,
        confirmed: true,
      }),
    }
  );
  if (!response.ok) {
    throw await responseError(response, 'Não foi possível aplicar a decisão de ownership.');
  }
};
