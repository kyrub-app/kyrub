import { FieldValue } from 'firebase-admin/firestore';
import type { StoreOperationProposal, StoreOpeningHoursPatch, StoreOperationalStatus } from '../../shared/storeOperationAction.js';
import { adminDb, adminAuth } from '../firebaseAdmin.js';
import { KyrubActionExecutionError } from './actionExecutionService.js';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const VALID_STATUS = new Set<StoreOperationalStatus>(['open', 'delayed', 'closed']);
const VALID_DAYS = new Set(['monday','tuesday','wednesday','thursday','friday','saturday','sunday']);

const bearer = (authorization: string): string => authorization.replace(/^Bearer\s+/i, '').trim();

const readProposal = (raw: unknown): StoreOperationProposal | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const proposal = (raw as Record<string, unknown>).proposal;
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) return null;
  const value = proposal as Record<string, unknown>;
  if (value.type !== 'update_store_operation') return null;
  return value as unknown as StoreOperationProposal;
};

export const isKyrubStoreOperationExecutionRequest = (raw: unknown): boolean => Boolean(readProposal(raw));

const normalizeHours = (entries: StoreOpeningHoursPatch[] | undefined): StoreOpeningHoursPatch[] => {
  if (!entries) return [];
  if (!Array.isArray(entries) || entries.length > 7) {
    throw new KyrubActionExecutionError(400, 'INVALID_STORE_HOURS', 'Os horários informados são inválidos.');
  }
  const seen = new Set<string>();
  return entries.map(entry => {
    if (!entry || !VALID_DAYS.has(entry.day) || seen.has(entry.day)) {
      throw new KyrubActionExecutionError(400, 'INVALID_STORE_HOURS', 'Há um dia inválido ou repetido nos horários.');
    }
    seen.add(entry.day);
    if (!entry.enabled) return { day: entry.day, enabled: false, opensAt: '', closesAt: '' };
    if (!TIME_PATTERN.test(entry.opensAt) || !TIME_PATTERN.test(entry.closesAt) || entry.opensAt === entry.closesAt) {
      throw new KyrubActionExecutionError(400, 'INVALID_STORE_HOURS', 'Informe horários válidos e diferentes para abertura e fechamento.');
    }
    return { day: entry.day, enabled: true, opensAt: entry.opensAt, closesAt: entry.closesAt };
  });
};

const canonicalStoreRef = async (uid: string) => {
  const snapshot = await adminDb.collection('stores').where('ownerId', '==', uid).get();
  const matches = snapshot.docs.filter(doc => {
    const data = doc.data() as Record<string, unknown>;
    return data.legacyTenantId === uid || (!data.legacyTenantId && data.ownerId === uid);
  });
  if (matches.length !== 1) {
    throw new KyrubActionExecutionError(409, 'CANONICAL_STORE_REQUIRED', 'Não foi possível confirmar uma única loja canônica para esta operação.');
  }
  return matches[0].ref;
};

export const executeAuthorizedKyrubStoreOperation = async (authorization: string, raw: unknown): Promise<any> => {
  const proposal = readProposal(raw);
  if (!proposal) throw new KyrubActionExecutionError(400, 'INVALID_STORE_OPERATION', 'A proposta operacional da loja é inválida.');
  const request = raw as Record<string, unknown>;
  if (request.confirmed !== true || proposal.requiresConfirmation !== true) {
    throw new KyrubActionExecutionError(409, 'CONFIRMATION_REQUIRED', 'Esta alteração operacional exige confirmação humana.');
  }
  const token = bearer(authorization);
  if (!token) throw new KyrubActionExecutionError(401, 'AUTH_REQUIRED', 'Autenticação obrigatória.');
  const actor = await adminAuth.verifyIdToken(token);
  const uid = actor.uid;
  const hours = normalizeHours(proposal.openingHours);
  const nextStatus = proposal.status;
  if (!nextStatus && hours.length === 0) {
    throw new KyrubActionExecutionError(400, 'EMPTY_STORE_OPERATION', 'Informe o status ou ao menos um horário para alterar.');
  }
  if (nextStatus && !VALID_STATUS.has(nextStatus)) {
    throw new KyrubActionExecutionError(400, 'INVALID_STORE_STATUS', 'O estado operacional informado é inválido.');
  }

  const tenantRef = adminDb.doc(`tenants/${uid}`);
  const privateRef = adminDb.doc(`users/${uid}/stores/${uid}`);
  const publicRef = await canonicalStoreRef(uid);
  const receiptId = (proposal.idempotencyKey || proposal.id).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 180);
  const receiptRef = adminDb.doc(`users/${uid}/actionReceipts/${receiptId}`);

  return adminDb.runTransaction(async transaction => {
    const [receipt, privateStore] = await Promise.all([transaction.get(receiptRef), transaction.get(privateRef)]);
    if (receipt.exists) return receipt.data();
    if (!privateStore.exists) throw new KyrubActionExecutionError(404, 'STORE_NOT_FOUND', 'A loja ativa não foi encontrada.');
    const current = privateStore.data() as Record<string, unknown>;
    if (proposal.expectedCurrentStatus && current.status !== proposal.expectedCurrentStatus) {
      throw new KyrubActionExecutionError(409, 'STORE_STATUS_CHANGED', 'O estado da loja mudou desde a proposta. Atualize antes de confirmar.');
    }

    if (hours.length) {
      const patch = Object.fromEntries(hours.map(item => [item.day, { enabled: item.enabled, opensAt: item.opensAt, closesAt: item.closesAt }]));
      transaction.set(tenantRef, { operationalSettings: { openingHours: patch }, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    if (nextStatus) {
      transaction.set(privateRef, { status: nextStatus, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      transaction.set(publicRef, { status: nextStatus, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }

    const result = {
      actionId: proposal.id,
      type: 'update_store_operation',
      status: 'success',
      entityId: uid,
      origin: proposal.origin || 'kyrubia',
      idempotencyKey: proposal.idempotencyKey || proposal.id,
    };
    transaction.create(receiptRef, { ...result, createdAt: FieldValue.serverTimestamp() });
    return result;
  });
};
