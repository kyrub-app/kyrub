import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { loadOwnerStoreInstitutionalRepresentation } from '../store/storeInstitutionalIdentityService.js';
import {
  buildStoreCommerceChannelDeclaration,
  buildStoreCommerceChannelDeclarationFromAnswer,
  normalizeCommerceChannels,
  type StoreCommerceChannelDeclaration,
} from '../../shared/storeConnectionOnboarding.js';
import type { KyrubCommerceChannel } from '../../shared/storeConnections.js';
import { listPublicStoreConnectionRegistry } from './storeConnectionRegistry.js';

const declarationPath = (storeId: string): string =>
  `stores/${storeId}/storeConnectionOnboarding/current`;

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const parseDeclaration = (
  value: unknown
): StoreCommerceChannelDeclaration | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (
    raw.schemaVersion !== 1 ||
    raw.source !== 'merchant_onboarding' ||
    raw.authority !== 'store_owner'
  ) return null;
  try {
    return buildStoreCommerceChannelDeclaration({
      storeId: clean(raw.storeId),
      channels: normalizeCommerceChannels(raw.channels),
      declaredByUserId: clean(raw.declaredByUserId),
      declaredAt: clean(raw.declaredAt),
    });
  } catch {
    return null;
  }
};

const assertOwner = async (storeId: string, userId: string): Promise<void> => {
  await loadOwnerStoreInstitutionalRepresentation({
    storeId,
    authenticatedUserId: userId,
  });
};

export const saveStoreCommerceChannelDeclaration = async (input: {
  storeId: string;
  userId: string;
  channels?: KyrubCommerceChannel[];
  answer?: string;
}): Promise<StoreCommerceChannelDeclaration> => {
  const storeId = clean(input.storeId);
  const userId = clean(input.userId);
  if (!storeId || !userId) throw new Error('STORE_CHANNEL_DECLARATION_TARGET_REQUIRED');
  await assertOwner(storeId, userId);
  const declaredAt = new Date().toISOString();
  const declaration = typeof input.answer === 'string'
    ? buildStoreCommerceChannelDeclarationFromAnswer({
        storeId,
        answer: input.answer,
        declaredByUserId: userId,
        declaredAt,
      })
    : buildStoreCommerceChannelDeclaration({
        storeId,
        channels: normalizeCommerceChannels(input.channels),
        declaredByUserId: userId,
        declaredAt,
      });

  await adminDb.doc(declarationPath(storeId)).set({
    ...declaration,
    serverUpdatedAt: FieldValue.serverTimestamp(),
  });
  return declaration;
};

export const loadStoreConnectionOnboarding = async (input: {
  storeId: string;
  userId: string;
}) => {
  const storeId = clean(input.storeId);
  const userId = clean(input.userId);
  if (!storeId || !userId) throw new Error('STORE_CHANNEL_DECLARATION_TARGET_REQUIRED');
  await assertOwner(storeId, userId);
  const [declarationSnapshot, connections] = await Promise.all([
    adminDb.doc(declarationPath(storeId)).get(),
    listPublicStoreConnectionRegistry(storeId),
  ]);
  return {
    storeId,
    question: 'Você já vende em algum lugar?',
    declaration: declarationSnapshot.exists
      ? parseDeclaration(declarationSnapshot.data())
      : null,
    connections,
  };
};
