import { createHash } from 'node:crypto';
import { FieldValue, type Transaction } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { getPrimaryUserStoreDocumentPath } from '../../src/utils/storePaths.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const maskEmail = (value: unknown): string => {
  const email = clean(value).toLocaleLowerCase('pt-BR');
  const at = email.indexOf('@');
  if (at <= 0 || at === email.length - 1) return '';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return `${local.slice(0, 1)}${local.length > 1 ? '***' : ''}@${domain}`;
};

export type StoreOwnerGovernanceState =
  | 'no_conflict'
  | 'multiple_active_owners'
  | 'canonical_owner_not_active'
  | 'authority_scope_mismatch';

export interface StoreOwnerGovernanceCandidate {
  selectionId: string;
  displayName: string;
  emailHint: string;
  selectable: boolean;
}

export interface StoreOwnerGovernancePreview {
  state: StoreOwnerGovernanceState;
  actionable: boolean;
  conflictId: string;
  activeOwnerCount: number;
  canonicalOwnerProtected: boolean;
  canonicalOwnerActivationId: string;
  candidates: StoreOwnerGovernanceCandidate[];
  requiresConfirmation: boolean;
  checkedAt: string;
}

type GovernanceContext = {
  state: StoreOwnerGovernanceState;
  tenantId: string;
  canonicalStoreId: string;
  canonicalOwnerId: string;
  activeOwnerIds: string[];
  extraOwnerIds: string[];
  conflictId: string;
};

type SimpleDocument = {
  exists: boolean;
  data: Record<string, unknown> | undefined;
};

type SimpleMember = {
  id: string;
  data: Record<string, unknown>;
};

type GovernanceReader = {
  getDocument: (path: string) => Promise<SimpleDocument>;
  getOwnerMembers: (canonicalStoreId: string) => Promise<SimpleMember[]>;
};

const conflictIdFor = (input: {
  tenantId: string;
  canonicalStoreId: string;
  canonicalOwnerId: string;
  activeOwnerIds: string[];
}): string => `owner-governance-${createHash('sha256')
  .update(JSON.stringify({
    tenantId: input.tenantId,
    canonicalStoreId: input.canonicalStoreId,
    canonicalOwnerId: input.canonicalOwnerId,
    activeOwnerIds: [...input.activeOwnerIds].sort(),
  }))
  .digest('hex')
  .slice(0, 40)}`;

const selectionIdFor = (conflictId: string, memberUserId: string): string =>
  `owner-selection-${createHash('sha256')
    .update(`${conflictId}:${memberUserId}`)
    .digest('hex')
    .slice(0, 32)}`;

const canonicalOwnerActivationIdFor = (
  conflictId: string,
  canonicalOwnerId: string
): string => `canonical-owner-activation-${createHash('sha256')
  .update(`${conflictId}:${canonicalOwnerId}:activate-canonical-owner`)
  .digest('hex')
  .slice(0, 40)}`;

const inspectGovernanceContext = async (
  reader: GovernanceReader,
  tenantIdInput: string
): Promise<GovernanceContext> => {
  const tenantId = clean(tenantIdInput);
  if (!tenantId) throw new Error('STORE_OWNER_GOVERNANCE_FORBIDDEN');

  const [privateStoreSnapshot, tenantSnapshot] = await Promise.all([
    reader.getDocument(getPrimaryUserStoreDocumentPath(tenantId)),
    reader.getDocument(`tenants/${tenantId}`),
  ]);
  const privateStore = privateStoreSnapshot.data;
  const tenant = tenantSnapshot.data;
  if (
    !privateStoreSnapshot.exists ||
    clean(privateStore?.id) !== tenantId ||
    clean(privateStore?.ownerId) !== tenantId ||
    !tenantSnapshot.exists ||
    clean(tenant?.ownerId) !== tenantId
  ) {
    return {
      state: 'authority_scope_mismatch',
      tenantId,
      canonicalStoreId: '',
      canonicalOwnerId: '',
      activeOwnerIds: [],
      extraOwnerIds: [],
      conflictId: '',
    };
  }

  const tenantCanonicalStoreId = clean(tenant?.canonicalStoreId);
  const privateCanonicalStoreId = clean(privateStore?.canonicalStoreId);
  const canonicalStoreId = tenantCanonicalStoreId || privateCanonicalStoreId;
  if (
    !canonicalStoreId ||
    canonicalStoreId === tenantId ||
    (tenantCanonicalStoreId && privateCanonicalStoreId && tenantCanonicalStoreId !== privateCanonicalStoreId)
  ) {
    return {
      state: 'authority_scope_mismatch',
      tenantId,
      canonicalStoreId,
      canonicalOwnerId: '',
      activeOwnerIds: [],
      extraOwnerIds: [],
      conflictId: '',
    };
  }

  const canonicalStoreSnapshot = await reader.getDocument(`stores/${canonicalStoreId}`);
  const canonicalStore = canonicalStoreSnapshot.data;
  const canonicalOwnerId = clean(canonicalStore?.ownerId);
  const legacyTenantId = clean(canonicalStore?.legacyTenantId);
  if (
    !canonicalStoreSnapshot.exists ||
    canonicalOwnerId !== tenantId ||
    (legacyTenantId && legacyTenantId !== tenantId)
  ) {
    return {
      state: 'authority_scope_mismatch',
      tenantId,
      canonicalStoreId,
      canonicalOwnerId,
      activeOwnerIds: [],
      extraOwnerIds: [],
      conflictId: '',
    };
  }

  const ownerMembers = await reader.getOwnerMembers(canonicalStoreId);
  const activeOwnerIds = ownerMembers.flatMap(member => {
    const data = member.data;
    return data.status === 'active' && clean(data.userId) === member.id
      ? [member.id]
      : [];
  }).sort();

  if (activeOwnerIds.length === 0) {
    return {
      state: 'no_conflict',
      tenantId,
      canonicalStoreId,
      canonicalOwnerId,
      activeOwnerIds,
      extraOwnerIds: [],
      conflictId: '',
    };
  }

  const conflictId = conflictIdFor({
    tenantId,
    canonicalStoreId,
    canonicalOwnerId,
    activeOwnerIds,
  });
  if (!activeOwnerIds.includes(canonicalOwnerId)) {
    return {
      state: 'canonical_owner_not_active',
      tenantId,
      canonicalStoreId,
      canonicalOwnerId,
      activeOwnerIds,
      extraOwnerIds: [],
      conflictId,
    };
  }

  if (activeOwnerIds.length === 1) {
    return {
      state: 'no_conflict',
      tenantId,
      canonicalStoreId,
      canonicalOwnerId,
      activeOwnerIds,
      extraOwnerIds: [],
      conflictId: '',
    };
  }

  return {
    state: 'multiple_active_owners',
    tenantId,
    canonicalStoreId,
    canonicalOwnerId,
    activeOwnerIds,
    extraOwnerIds: activeOwnerIds.filter(userId => userId !== canonicalOwnerId),
    conflictId,
  };
};

const databaseReader: GovernanceReader = {
  getDocument: async path => {
    const snapshot = await adminDb.doc(path).get();
    return {
      exists: snapshot.exists,
      data: snapshot.exists
        ? snapshot.data() as Record<string, unknown>
        : undefined,
    };
  },
  getOwnerMembers: async canonicalStoreId => {
    const snapshot = await adminDb
      .collection(`stores/${canonicalStoreId}/members`)
      .where('role', '==', 'owner')
      .get();
    return snapshot.docs.map(document => ({
      id: document.id,
      data: document.data() as Record<string, unknown>,
    }));
  },
};

const transactionReader = (transaction: Transaction): GovernanceReader => ({
  getDocument: async path => {
    const snapshot = await transaction.get(adminDb.doc(path));
    return {
      exists: snapshot.exists,
      data: snapshot.exists
        ? snapshot.data() as Record<string, unknown>
        : undefined,
    };
  },
  getOwnerMembers: async canonicalStoreId => {
    const snapshot = await transaction.get(
      adminDb
        .collection(`stores/${canonicalStoreId}/members`)
        .where('role', '==', 'owner')
    );
    return snapshot.docs.map(document => ({
      id: document.id,
      data: document.data() as Record<string, unknown>,
    }));
  },
});

const candidateProfile = async (
  conflictId: string,
  memberUserId: string
): Promise<StoreOwnerGovernanceCandidate> => {
  const profileSnapshot = await adminDb.doc(`users/${memberUserId}`).get();
  const profile = profileSnapshot.data() as Record<string, unknown> | undefined;
  const displayName = clean(profile?.name);
  const emailHint = maskEmail(profile?.email);
  const selectable = Boolean(displayName || emailHint);
  return {
    selectionId: selectable ? selectionIdFor(conflictId, memberUserId) : '',
    displayName: displayName || 'Owner adicional sem identificação pública',
    emailHint,
    selectable,
  };
};

export const loadStoreOwnerGovernancePreview = async (input: {
  tenantId: string;
  requestedByUserId: string;
}): Promise<StoreOwnerGovernancePreview> => {
  const tenantId = clean(input.tenantId);
  const requestedByUserId = clean(input.requestedByUserId);
  if (!tenantId || requestedByUserId !== tenantId) {
    throw new Error('STORE_OWNER_GOVERNANCE_FORBIDDEN');
  }

  const context = await inspectGovernanceContext(databaseReader, tenantId);
  const candidates = context.state === 'multiple_active_owners'
    ? await Promise.all(
        context.extraOwnerIds.map(userId => candidateProfile(context.conflictId, userId))
      )
    : [];
  const canonicalOwnerActivationId = context.state === 'canonical_owner_not_active'
    ? canonicalOwnerActivationIdFor(context.conflictId, context.canonicalOwnerId)
    : '';
  return {
    state: context.state,
    actionable: context.state === 'multiple_active_owners' && candidates.some(candidate => candidate.selectable),
    conflictId: context.conflictId,
    activeOwnerCount: context.activeOwnerIds.length,
    canonicalOwnerProtected: context.state === 'multiple_active_owners',
    canonicalOwnerActivationId,
    candidates,
    requiresConfirmation:
      context.state === 'multiple_active_owners' || context.state === 'canonical_owner_not_active',
    checkedAt: new Date().toISOString(),
  };
};

export const applyStoreOwnerGovernanceDecision = async (input: {
  tenantId: string;
  requestedByUserId: string;
  conflictId: string;
  selectionId: string;
  confirmed: boolean;
}): Promise<{ conflictId: string; selectionId: string; applied: true }> => {
  const tenantId = clean(input.tenantId);
  const requestedByUserId = clean(input.requestedByUserId);
  const expectedConflictId = clean(input.conflictId);
  const expectedSelectionId = clean(input.selectionId);
  if (!tenantId || requestedByUserId !== tenantId) {
    throw new Error('STORE_OWNER_GOVERNANCE_FORBIDDEN');
  }
  if (!input.confirmed) throw new Error('STORE_OWNER_GOVERNANCE_CONFIRMATION_REQUIRED');
  if (!expectedConflictId) throw new Error('STORE_OWNER_GOVERNANCE_CONFLICT_ID_REQUIRED');
  if (!expectedSelectionId) throw new Error('STORE_OWNER_GOVERNANCE_SELECTION_REQUIRED');

  return adminDb.runTransaction(async transaction => {
    const context = await inspectGovernanceContext(transactionReader(transaction), tenantId);
    if (
      context.state !== 'multiple_active_owners' ||
      !context.conflictId ||
      context.extraOwnerIds.length === 0
    ) {
      throw new Error('STORE_OWNER_GOVERNANCE_NOT_ACTIONABLE');
    }
    if (context.conflictId !== expectedConflictId) {
      throw new Error('STORE_OWNER_GOVERNANCE_STALE');
    }

    const selectedOwnerIds = context.extraOwnerIds.filter(
      userId => selectionIdFor(context.conflictId, userId) === expectedSelectionId
    );
    if (selectedOwnerIds.length !== 1) {
      throw new Error('STORE_OWNER_GOVERNANCE_SELECTION_INVALID');
    }
    const selectedOwnerId = selectedOwnerIds[0];
    if (selectedOwnerId === context.canonicalOwnerId) {
      throw new Error('STORE_OWNER_GOVERNANCE_CANONICAL_OWNER_PROTECTED');
    }

    const profileSnapshot = await transaction.get(adminDb.doc(`users/${selectedOwnerId}`));
    const profile = profileSnapshot.data() as Record<string, unknown> | undefined;
    if (!profileSnapshot.exists || (!clean(profile?.name) && !maskEmail(profile?.email))) {
      throw new Error('STORE_OWNER_GOVERNANCE_CANDIDATE_UNIDENTIFIABLE');
    }

    const memberRef = adminDb.doc(
      `stores/${context.canonicalStoreId}/members/${selectedOwnerId}`
    );
    const decisionId = `owner-decision-${createHash('sha256')
      .update(`${context.conflictId}:${selectedOwnerId}`)
      .digest('hex')
      .slice(0, 40)}`;
    const decisionRef = adminDb.doc(
      `stores/${context.canonicalStoreId}/ownerGovernanceDecisions/${decisionId}`
    );
    const decisionSnapshot = await transaction.get(decisionRef);
    if (decisionSnapshot.exists) {
      throw new Error('STORE_OWNER_GOVERNANCE_STALE');
    }

    transaction.set(
      memberRef,
      {
        status: 'inactive',
        ownerAuthorityRevokedAt: FieldValue.serverTimestamp(),
        ownerAuthorityRevokedBy: requestedByUserId,
        ownerAuthorityRevocationReason: 'canonical_owner_conflict_resolution',
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    transaction.set(decisionRef, {
      schemaVersion: 1,
      id: decisionId,
      conflictId: context.conflictId,
      action: 'deactivate_additional_owner_membership',
      canonicalOwnerProtected: true,
      selectedMemberUserId: selectedOwnerId,
      requestedByUserId,
      authority: 'explicit_store_owner_confirmation',
      confirmed: true,
      appliedAt: FieldValue.serverTimestamp(),
    });

    return {
      conflictId: context.conflictId,
      selectionId: expectedSelectionId,
      applied: true as const,
    };
  });
};

export const applyCanonicalOwnerReconciliation = async (input: {
  tenantId: string;
  requestedByUserId: string;
  conflictId: string;
  activationId: string;
  confirmed: boolean;
}): Promise<{ conflictId: string; activationId: string; applied: true }> => {
  const tenantId = clean(input.tenantId);
  const requestedByUserId = clean(input.requestedByUserId);
  const expectedConflictId = clean(input.conflictId);
  const expectedActivationId = clean(input.activationId);
  if (!tenantId || requestedByUserId !== tenantId) {
    throw new Error('STORE_OWNER_GOVERNANCE_FORBIDDEN');
  }
  if (!input.confirmed) throw new Error('STORE_CANONICAL_OWNER_RECONCILIATION_CONFIRMATION_REQUIRED');
  if (!expectedConflictId || !expectedActivationId) {
    throw new Error('STORE_CANONICAL_OWNER_RECONCILIATION_ID_REQUIRED');
  }

  return adminDb.runTransaction(async transaction => {
    const context = await inspectGovernanceContext(transactionReader(transaction), tenantId);
    if (
      context.state !== 'canonical_owner_not_active' ||
      !context.conflictId ||
      !context.canonicalOwnerId
    ) {
      throw new Error('STORE_CANONICAL_OWNER_RECONCILIATION_NOT_ACTIONABLE');
    }
    const currentActivationId = canonicalOwnerActivationIdFor(
      context.conflictId,
      context.canonicalOwnerId
    );
    if (
      context.conflictId !== expectedConflictId ||
      currentActivationId !== expectedActivationId
    ) {
      throw new Error('STORE_CANONICAL_OWNER_RECONCILIATION_STALE');
    }

    const memberRef = adminDb.doc(
      `stores/${context.canonicalStoreId}/members/${context.canonicalOwnerId}`
    );
    const memberSnapshot = await transaction.get(memberRef);
    const member = memberSnapshot.data() as Record<string, unknown> | undefined;
    const existingUserId = clean(member?.userId);
    if (memberSnapshot.exists && existingUserId && existingUserId !== context.canonicalOwnerId) {
      throw new Error('STORE_CANONICAL_OWNER_RECONCILIATION_MEMBER_CONFLICT');
    }

    const decisionId = `canonical-owner-reconciliation-${createHash('sha256')
      .update(`${context.conflictId}:${context.canonicalOwnerId}`)
      .digest('hex')
      .slice(0, 40)}`;
    const decisionRef = adminDb.doc(
      `stores/${context.canonicalStoreId}/ownerGovernanceDecisions/${decisionId}`
    );
    const decisionSnapshot = await transaction.get(decisionRef);
    if (decisionSnapshot.exists) {
      throw new Error('STORE_CANONICAL_OWNER_RECONCILIATION_STALE');
    }

    transaction.set(
      memberRef,
      {
        userId: context.canonicalOwnerId,
        role: 'owner',
        status: 'active',
        ...(memberSnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
        canonicalOwnerReconciledAt: FieldValue.serverTimestamp(),
        canonicalOwnerReconciledBy: requestedByUserId,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    transaction.set(decisionRef, {
      schemaVersion: 1,
      id: decisionId,
      conflictId: context.conflictId,
      activationId: currentActivationId,
      action: 'activate_canonical_owner_membership',
      canonicalOwnerUserId: context.canonicalOwnerId,
      requestedByUserId,
      authority: 'explicit_canonical_store_owner_confirmation',
      confirmed: true,
      appliedAt: FieldValue.serverTimestamp(),
    });

    return {
      conflictId: context.conflictId,
      activationId: currentActivationId,
      applied: true as const,
    };
  });
};
