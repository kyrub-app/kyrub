import { adminDb } from '../firebaseAdmin.js';
import { getPrimaryUserStoreDocumentPath } from '../../src/utils/storePaths.js';
import { legacyMercadoPagoStoreIdFromPrimaryOwner } from '../../shared/mercadoPagoLegacyOwnerStoreScope.js';
import {
  buildPlatformPlanRecipientAuthority,
  buildStoreCommercialRecipientAuthority,
  type CommercialPaymentContext,
  type CommercialRecipientAuthority,
} from '../../shared/commercialRecipientAuthority.js';
import { loadMercadoPagoStoreConnectionMetadata } from '../integrations/mercadoPagoStoreConnectionSecretStore.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const validIdentity = (value: string): boolean =>
  Boolean(value) && value.length <= 180 && !value.includes('/');

const canonicalStoreIdentity = async (
  canonicalStoreIdInput: string
): Promise<{ canonicalStoreId: string; ownerUserId: string; credentialScopeId: string }> => {
  const canonicalStoreId = clean(canonicalStoreIdInput);
  if (!validIdentity(canonicalStoreId)) {
    throw new Error('COMMERCIAL_RECIPIENT_STORE_REQUIRED');
  }

  const snapshot = await adminDb.doc(`stores/${canonicalStoreId}`).get();
  let ownerUserId = '';
  let credentialScopeId = '';
  if (snapshot.exists) {
    const data = snapshot.data() as Record<string, unknown>;
    ownerUserId = clean(data.ownerId);
    credentialScopeId = clean(data.legacyTenantId) || ownerUserId;
  } else {
    // Some existing canonical owner stores are saved only under users/{uid}/stores/{uid}.
    // This is a strict identity-checked read fallback, never a new store or token.
    const primary = await adminDb.doc(getPrimaryUserStoreDocumentPath(canonicalStoreId)).get();
    if (!primary.exists) throw new Error('COMMERCIAL_RECIPIENT_STORE_NOT_FOUND');
    const primaryStore = primary.data() as Record<string, unknown>;
    credentialScopeId = legacyMercadoPagoStoreIdFromPrimaryOwner(canonicalStoreId, primaryStore);
    ownerUserId = canonicalStoreId;
  }

  if (
    !validIdentity(ownerUserId) ||
    !validIdentity(credentialScopeId) ||
    credentialScopeId !== ownerUserId
  ) {
    throw new Error('COMMERCIAL_RECIPIENT_STORE_SCOPE_INVALID');
  }

  return { canonicalStoreId, ownerUserId, credentialScopeId };
};

export const resolveCommercialRecipientAuthority = async (input: {
  context: CommercialPaymentContext;
  canonicalStoreId?: string;
}): Promise<CommercialRecipientAuthority> => {
  if (input.context === 'platform_plan_subscription') {
    return buildPlatformPlanRecipientAuthority();
  }

  if (input.context !== 'store_sale' && input.context !== 'store_subscription') {
    throw new Error('COMMERCIAL_RECIPIENT_CONTEXT_UNSUPPORTED');
  }

  const store = await canonicalStoreIdentity(input.canonicalStoreId ?? '');
  const connection = await loadMercadoPagoStoreConnectionMetadata(
    store.credentialScopeId
  );

  if (
    !connection ||
    connection.status !== 'connected' ||
    !clean(connection.externalAccountId)
  ) {
    throw new Error('COMMERCIAL_RECIPIENT_STORE_PAYMENT_NOT_CONNECTED');
  }

  return buildStoreCommercialRecipientAuthority({
    context: input.context,
    canonicalStoreId: store.canonicalStoreId,
    ownerUserId: store.ownerUserId,
    credentialScopeId: store.credentialScopeId,
    externalAccountId: connection.externalAccountId,
  });
};
