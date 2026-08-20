import { FieldValue } from 'firebase-admin/firestore';
import type { KyrubActionExecutionResult } from '../../shared/kyrubActions.js';
import { adminDb } from '../firebaseAdmin.js';
import {
  executeAuthorizedKyrubAction as executeLegacyAuthorizedKyrubAction,
  KyrubActionExecutionError,
} from './actionExecutionService.js';

const cleanText = (value: unknown, maximum: number): string =>
  typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const cleanStringList = (
  value: unknown,
  maximumItems: number,
  maximumItemCharacters: number
): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap(item => {
    const normalized = cleanText(item, maximumItemCharacters);
    if (!normalized || seen.has(normalized)) return [];
    seen.add(normalized);
    return [normalized];
  }).slice(0, maximumItems);
};

const requestProposalType = (rawRequest: unknown): string => {
  if (!rawRequest || typeof rawRequest !== 'object' || Array.isArray(rawRequest)) {
    return '';
  }
  const proposal = (rawRequest as Record<string, unknown>).proposal;
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) {
    return '';
  }
  return cleanText((proposal as Record<string, unknown>).type, 80);
};

export const isKyrubStoreProfileExecutionRequest = (
  rawRequest: unknown
): boolean => requestProposalType(rawRequest) === 'update_store_profile';

const findCanonicalStoreReference = async (uid: string) => {
  const snapshot = await adminDb
    .collection('stores')
    .where('ownerId', '==', uid)
    .get();

  const matches = snapshot.docs.filter(document => {
    const data = document.data() as Record<string, unknown>;
    return data.legacyTenantId === uid ||
      (!data.legacyTenantId && data.ownerId === uid);
  });

  if (matches.length > 1) {
    throw new KyrubActionExecutionError(
      409,
      'STORE_IDENTITY_CONFLICT',
      'Mais de uma loja canônica pertence a este cadastro. Revise a estrutura antes de continuar.'
    );
  }

  return matches[0]?.ref ?? null;
};

const synchronizeCanonicalStoreProfile = async (uid: string): Promise<void> => {
  const privateReference = adminDb.doc(`users/${uid}/stores/${uid}`);
  const [privateSnapshot, canonicalReference] = await Promise.all([
    privateReference.get(),
    findCanonicalStoreReference(uid),
  ]);

  if (!privateSnapshot.exists || !canonicalReference) {
    throw new KyrubActionExecutionError(
      409,
      'CANONICAL_STORE_REQUIRED',
      'A loja foi atualizada, mas o registro canônico ainda não está disponível para sincronização.'
    );
  }

  const store = privateSnapshot.data() as Record<string, unknown>;
  const name = cleanText(store.name, 120);
  if (!name) {
    throw new KyrubActionExecutionError(
      409,
      'STORE_PROFILE_INCOMPLETE',
      'A loja foi atualizada, mas o nome canônico não pôde ser confirmado.'
    );
  }

  const canonicalPatch: Record<string, unknown> = {
    name,
    description: cleanText(store.description, 1_000),
    address: cleanText(store.address, 240),
    contact: cleanText(store.contact, 160),
    keywords: cleanStringList(store.keywords, 30, 60),
    logo: cleanText(store.logo, 2_000),
    banner: cleanText(store.banner, 2_000),
    primaryColor: cleanText(store.primaryColor, 40),
    slug: cleanText(store.slug, 120),
    plan: store.plan === 'pro' || store.plan === 'business' ? store.plan : 'free',
    legacyTenantId: uid,
    profileSyncVersion: 1,
    profileSyncedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  await canonicalReference.set(canonicalPatch, { merge: true });
};

export const executeAuthorizedKyrubStoreProfileUpdate = async (
  authorization: string,
  rawRequest: unknown
): Promise<KyrubActionExecutionResult> => {
  const result = await executeLegacyAuthorizedKyrubAction(
    authorization,
    rawRequest
  );

  if (result.type !== 'update_store_profile') {
    throw new KyrubActionExecutionError(
      500,
      'STORE_PROFILE_EXECUTION_MISMATCH',
      'O executor retornou um recibo incompatível com a atualização da loja.'
    );
  }

  await synchronizeCanonicalStoreProfile(result.entityId);
  return result;
};
