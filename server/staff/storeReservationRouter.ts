import { Router } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { adminDb } from '../firebaseAdmin.js';
import { hasStorePermission, parseStoreMember } from '../../src/utils/storeSecurity.js';

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const bearer = (value: string): string => /^Bearer\s+(.+)$/i.exec(value)?.[1]?.trim() ?? '';

const authorize = async (authorization: string, legacyStoreId: string) => {
  const token = bearer(authorization);
  if (!token) throw new Error('AUTH_REQUIRED');
  const identity = await verifyFirebaseIdToken(token);
  const tenant = await adminDb.doc(`tenants/${legacyStoreId}`).get();
  const canonicalStoreId = clean(tenant.data()?.canonicalStoreId);
  if (!canonicalStoreId) throw new Error('RESERVATION_STORE_NOT_FOUND');
  if (identity.uid === legacyStoreId) return { userId: identity.uid, canonicalStoreId };

  const snapshot = await adminDb.doc(`stores/${canonicalStoreId}/members/${identity.uid}`).get();
  const member = parseStoreMember(snapshot.data());
  if (!member || member.status !== 'active' || !hasStorePermission(member.role, 'orders.create')) {
    throw new Error('RESERVATION_FORBIDDEN');
  }
  return { userId: identity.uid, canonicalStoreId };
};

const errorResponse = (error: unknown) => {
  const code = error instanceof Error ? error.message : String(error);
  if (code === 'AUTH_REQUIRED') return { status: 401, error: 'Autenticação necessária.' };
  if (code === 'RESERVATION_FORBIDDEN') return { status: 403, error: 'Seu acesso não permite gerenciar reservas.' };
  if (code === 'RESERVATION_STORE_NOT_FOUND') return { status: 404, error: 'Loja canônica não encontrada.' };
  return { status: 503, error: 'Reservas temporariamente indisponíveis.' };
};

export const createStoreReservationRouter = (): Router => {
  const router = Router();

  router.get('/', async (request, response) => {
    try {
      const storeId = clean(request.query.storeId);
      const actor = await authorize(request.get('authorization') ?? '', storeId);
      const snapshot = await adminDb.collection(`stores/${actor.canonicalStoreId}/reservations`)
        .where('status', '==', 'scheduled').orderBy('scheduledAt', 'asc').limit(200).get();
      response.status(200).json({ reservations: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) });
    } catch (error) {
      const mapped = errorResponse(error); response.status(mapped.status).json({ error: mapped.error });
    }
  });

  router.post('/', async (request, response) => {
    try {
      const storeId = clean(request.body?.storeId);
      const clientName = clean(request.body?.clientName);
      const scheduledAt = clean(request.body?.scheduledAt);
      const people = Number(request.body?.people);
      if (!clientName || !scheduledAt || !Number.isFinite(people) || people < 1) {
        response.status(400).json({ error: 'Dados da reserva inválidos.' }); return;
      }
      const actor = await authorize(request.get('authorization') ?? '', storeId);
      const ref = adminDb.collection(`stores/${actor.canonicalStoreId}/reservations`).doc();
      await ref.set({
        clientName, scheduledAt, people: Math.floor(people), status: 'scheduled',
        createdBy: actor.userId, completedBy: null,
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      });
      response.status(201).json({ id: ref.id });
    } catch (error) {
      const mapped = errorResponse(error); response.status(mapped.status).json({ error: mapped.error });
    }
  });

  router.post('/:reservationId/complete', async (request, response) => {
    try {
      const storeId = clean(request.body?.storeId);
      const actor = await authorize(request.get('authorization') ?? '', storeId);
      const ref = adminDb.doc(`stores/${actor.canonicalStoreId}/reservations/${clean(request.params.reservationId)}`);
      const snapshot = await ref.get();
      if (!snapshot.exists) { response.status(404).json({ error: 'Reserva não encontrada.' }); return; }
      await ref.update({ status: 'completed', completedBy: actor.userId, completedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      response.status(200).json({ id: ref.id });
    } catch (error) {
      const mapped = errorResponse(error); response.status(mapped.status).json({ error: mapped.error });
    }
  });

  return router;
};
