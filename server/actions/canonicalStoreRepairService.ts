import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { adminDb } from '../firebaseAdmin.js';
import { KyrubActionExecutionError } from './actionExecutionService.js';

const cleanText = (value: unknown, maximum = 2_000): string =>
  typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const stringArrayHasValue = (value: unknown): boolean =>
  Array.isArray(value) && value.some(item => cleanText(item, 240));

export const hasMeaningfulPrivateStoreSetup = (
  data: Record<string, unknown>
): boolean =>
  Boolean(
    cleanText(data.name, 160) ||
      cleanText(data.slug, 160) ||
      cleanText(data.description, 2_000) ||
      cleanText(data.logo, 2_000) ||
      cleanText(data.banner, 2_000) ||
      cleanText(data.primaryColor, 80) ||
      cleanText(data.address, 500) ||
      cleanText(data.contact, 240) ||
      stringArrayHasValue(data.keywords) ||
      stringArrayHasValue(data.offerImages) ||
      data.status === 'open' ||
      data.status === 'delayed'
  );

const validPlan = (value: unknown): 'free' | 'pro' | 'business' =>
  value === 'pro' || value === 'business' ? value : 'free';

const recoveryCanonicalStoreId = (uid: string): string =>
  `store-recovered-${createHash('sha256').update(uid).digest('hex').slice(0, 24)}`;

const verifyActor = async (authorization: string): Promise<{ uid: string }> => {
  const token = bearerToken(authorization);
  if (!token) {
    throw new KyrubActionExecutionError(
      401,
      'AUTH_REQUIRED',
      'Faça login novamente para acessar sua loja.'
    );
  }

  try {
    return await verifyFirebaseIdToken(token);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : '';
    if (code === 'AUTH_UNAVAILABLE') {
      throw new KyrubActionExecutionError(
        503,
        'AUTH_UNAVAILABLE',
        'Não foi possível validar sua sessão agora.'
      );
    }
    throw new KyrubActionExecutionError(
      401,
      'AUTH_REQUIRED',
      'Sua sessão expirou. Entre novamente no Kyrub.'
    );
  }
};

const assertCanonicalOwnership = (
  uid: string,
  canonicalStoreId: string,
  data: Record<string, unknown>
): void => {
  if (cleanText(data.ownerId, 160) !== uid) {
    throw new KyrubActionExecutionError(
      409,
      'CANONICAL_STORE_CONFLICT',
      'O vínculo canônico da loja não pertence ao usuário autenticado.'
    );
  }

  const legacyTenantId = cleanText(data.legacyTenantId, 160);
  if (legacyTenantId && legacyTenantId !== uid) {
    throw new KyrubActionExecutionError(
      409,
      'CANONICAL_STORE_CONFLICT',
      'A loja canônica está vinculada a outra origem legada.'
    );
  }

  if (canonicalStoreId === uid) {
    throw new KyrubActionExecutionError(
      409,
      'CANONICAL_STORE_CONFLICT',
      'O identificador canônico da loja precisa ser independente do usuário.'
    );
  }
};

const persistPrivateLink = async (
  privateStorePath: string,
  canonicalStoreId: string
): Promise<void> => {
  await adminDb.doc(privateStorePath).set(
    {
      canonicalStoreId,
      canonicalStoreLinkedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
};

export const ensureCanonicalStoreForCatalog = async (
  authorization: string
): Promise<{ uid: string; canonicalStoreId: string; repaired: boolean }> => {
  const actor = await verifyActor(authorization);
  const uid = actor.uid;
  const privateStorePath = `users/${uid}/stores/${uid}`;
  const privateReference = adminDb.doc(privateStorePath);
  const privateSnapshot = await privateReference.get();

  if (!privateSnapshot.exists) {
    throw new KyrubActionExecutionError(
      409,
      'STORE_REQUIRED',
      'Ative sua Loja Kyrub antes de cadastrar produtos.'
    );
  }

  const privateStore = privateSnapshot.data() as Record<string, unknown>;
  if (!hasMeaningfulPrivateStoreSetup(privateStore)) {
    throw new KyrubActionExecutionError(
      409,
      'STORE_REQUIRED',
      'Ative novamente sua Loja Kyrub antes de cadastrar produtos.'
    );
  }

  const explicitCanonicalStoreId = cleanText(privateStore.canonicalStoreId, 160);
  if (explicitCanonicalStoreId) {
    const canonicalSnapshot = await adminDb.doc(`stores/${explicitCanonicalStoreId}`).get();
    if (canonicalSnapshot.exists) {
      assertCanonicalOwnership(
        uid,
        explicitCanonicalStoreId,
        canonicalSnapshot.data() as Record<string, unknown>
      );
      return { uid, canonicalStoreId: explicitCanonicalStoreId, repaired: false };
    }
  }

  const ownerSnapshot = await adminDb
    .collection('stores')
    .where('ownerId', '==', uid)
    .get();
  const ownerStores = ownerSnapshot.docs.map(document => ({
    id: document.id,
    data: document.data() as Record<string, unknown>,
  }));
  const legacyMatches = ownerStores.filter(
    store => cleanText(store.data.legacyTenantId, 160) === uid
  );

  if (legacyMatches.length > 1) {
    throw new KyrubActionExecutionError(
      409,
      'CANONICAL_STORE_CONFLICT',
      'Mais de uma loja canônica aponta para esta Loja Kyrub. Revise a migração antes de cadastrar produtos.'
    );
  }

  if (legacyMatches.length === 1) {
    const match = legacyMatches[0];
    assertCanonicalOwnership(uid, match.id, match.data);
    await persistPrivateLink(privateStorePath, match.id);
    return { uid, canonicalStoreId: match.id, repaired: true };
  }

  const privateName = cleanText(privateStore.name, 160).toLocaleLowerCase('pt-BR');
  const unlinkedNameMatches = ownerStores.filter(store => {
    const legacyTenantId = cleanText(store.data.legacyTenantId, 160);
    const canonicalName = cleanText(store.data.name, 160).toLocaleLowerCase('pt-BR');
    return !legacyTenantId && privateName && canonicalName === privateName;
  });

  if (unlinkedNameMatches.length === 1) {
    const match = unlinkedNameMatches[0];
    assertCanonicalOwnership(uid, match.id, match.data);
    await adminDb.doc(`stores/${match.id}`).set(
      {
        legacyTenantId: uid,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    await persistPrivateLink(privateStorePath, match.id);
    return { uid, canonicalStoreId: match.id, repaired: true };
  }

  if (unlinkedNameMatches.length > 1) {
    throw new KyrubActionExecutionError(
      409,
      'CANONICAL_STORE_CONFLICT',
      'Há mais de um registro canônico compatível com esta loja. Revise a migração antes de cadastrar produtos.'
    );
  }

  const canonicalStoreId = recoveryCanonicalStoreId(uid);
  const canonicalReference = adminDb.doc(`stores/${canonicalStoreId}`);

  await adminDb.runTransaction(async transaction => {
    const [freshPrivateSnapshot, canonicalSnapshot] = await Promise.all([
      transaction.get(privateReference),
      transaction.get(canonicalReference),
    ]);

    if (!freshPrivateSnapshot.exists) {
      throw new KyrubActionExecutionError(
        409,
        'STORE_REQUIRED',
        'Ative sua Loja Kyrub antes de cadastrar produtos.'
      );
    }

    const freshPrivateStore = freshPrivateSnapshot.data() as Record<string, unknown>;
    if (!hasMeaningfulPrivateStoreSetup(freshPrivateStore)) {
      throw new KyrubActionExecutionError(
        409,
        'STORE_REQUIRED',
        'Ative novamente sua Loja Kyrub antes de cadastrar produtos.'
      );
    }

    if (canonicalSnapshot.exists) {
      assertCanonicalOwnership(
        uid,
        canonicalStoreId,
        canonicalSnapshot.data() as Record<string, unknown>
      );
    } else {
      transaction.set(canonicalReference, {
        id: canonicalStoreId,
        ownerId: uid,
        name: cleanText(freshPrivateStore.name, 160) || 'Minha loja',
        publicationStatus: 'paused',
        plan: validPlan(freshPrivateStore.plan),
        legacyTenantId: uid,
        migrationStatus: 'registry_only',
        recoveredFromLegacyStore: true,
        recoveredAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    transaction.set(
      privateReference,
      {
        canonicalStoreId,
        canonicalStoreLinkedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });

  return { uid, canonicalStoreId, repaired: true };
};
