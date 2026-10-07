import { Router } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { adminDb } from '../firebaseAdmin.js';
import { parseStoreMember } from '../../src/utils/storeSecurity.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const resolveActor = async (authorization: string, legacyStoreId: string) => {
  const token = bearerToken(authorization);
  if (!token) throw new Error('AUTH_REQUIRED');
  const identity = await verifyFirebaseIdToken(token);
  const tenant = await adminDb.doc(`tenants/${legacyStoreId}`).get();
  const canonicalStoreId = clean(tenant.data()?.canonicalStoreId);
  if (!canonicalStoreId) throw new Error('TIME_CLOCK_STORE_NOT_FOUND');

  if (identity.uid === legacyStoreId) {
    return { userId: identity.uid, canonicalStoreId, role: 'owner' as const };
  }

  const memberSnapshot = await adminDb
    .doc(`stores/${canonicalStoreId}/members/${identity.uid}`)
    .get();
  const member = parseStoreMember(memberSnapshot.data());
  if (!member || member.status !== 'active') throw new Error('TIME_CLOCK_FORBIDDEN');
  return { userId: identity.uid, canonicalStoreId, role: member.role };
};

const mapError = (error: unknown) => {
  const code = error instanceof Error ? error.message : String(error);
  if (code === 'AUTH_REQUIRED') return { status: 401, message: 'Faça login novamente para registrar o ponto.' };
  if (code === 'TIME_CLOCK_FORBIDDEN') return { status: 403, message: 'Seu vínculo com esta loja não está ativo.' };
  if (code === 'TIME_CLOCK_STORE_NOT_FOUND') return { status: 404, message: 'A loja canônica não foi encontrada.' };
  if (code === 'TIME_CLOCK_ALREADY_OPEN' || code === 'TIME_CLOCK_NOT_OPEN') {
    return { status: 409, message: code === 'TIME_CLOCK_ALREADY_OPEN' ? 'Já existe um turno de ponto aberto.' : 'Não existe turno aberto para encerrar.' };
  }
  console.error('[Time clock]', error);
  return { status: 503, message: 'O registro de ponto está temporariamente indisponível.' };
};

export const createTimeClockRouter = (): Router => {
  const router = Router();

  router.get('/me', async (request, response) => {
    try {
      const storeId = clean(request.query.storeId);
      if (!storeId) throw new Error('TIME_CLOCK_STORE_NOT_FOUND');
      const actor = await resolveActor(request.get('authorization') ?? '', storeId);
      const snapshot = await adminDb
        .collection(`stores/${actor.canonicalStoreId}/timeClockEntries`)
        .where('userId', '==', actor.userId)
        .orderBy('clockInAt', 'desc')
        .limit(50)
        .get();
      response.status(200).json({ entries: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) });
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  router.post('/clock-in', async (request, response) => {
    try {
      const storeId = clean(request.body?.storeId);
      if (!storeId) throw new Error('TIME_CLOCK_STORE_NOT_FOUND');
      const actor = await resolveActor(request.get('authorization') ?? '', storeId);
      const entries = adminDb.collection(`stores/${actor.canonicalStoreId}/timeClockEntries`);
      const open = await entries.where('userId', '==', actor.userId).where('status', '==', 'open').limit(1).get();
      if (!open.empty) throw new Error('TIME_CLOCK_ALREADY_OPEN');
      const ref = entries.doc();
      await ref.set({
        userId: actor.userId,
        role: actor.role,
        status: 'open',
        clockInAt: FieldValue.serverTimestamp(),
        clockOutAt: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      response.status(201).json({ id: ref.id });
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  router.post('/clock-out', async (request, response) => {
    try {
      const storeId = clean(request.body?.storeId);
      if (!storeId) throw new Error('TIME_CLOCK_STORE_NOT_FOUND');
      const actor = await resolveActor(request.get('authorization') ?? '', storeId);
      const entries = adminDb.collection(`stores/${actor.canonicalStoreId}/timeClockEntries`);
      const open = await entries.where('userId', '==', actor.userId).where('status', '==', 'open').limit(1).get();
      if (open.empty) throw new Error('TIME_CLOCK_NOT_OPEN');
      const ref = open.docs[0].ref;
      await ref.update({
        status: 'closed',
        clockOutAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      response.status(200).json({ id: ref.id });
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  return router;
};
