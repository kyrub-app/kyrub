import { adminDb } from '../firebaseAdmin.js';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { parseStoreMember, type StoreRole } from '../../src/utils/storeSecurity.js';
import {
  buildUserNotification,
  userNotificationPath,
} from '../../shared/userNotifications.js';
import {
  canReadStaffNotice,
  isSafeStaffNoticeId,
  STAFF_NOTICE_MAX_MEMBERS,
  STAFF_NOTICE_MAX_RESULTS,
  validateStaffNoticeInput,
  type StaffNotice,
  type StaffNoticeForViewer,
} from '../../shared/staffNotices.js';

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const safeStoreId = (id: string): boolean => /^[A-Za-z0-9_-]{1,128}$/.test(id);
const bearer = (value: string): string =>
  /^Bearer\s+([^\s]+)$/i.exec(value)?.[1]?.trim() ?? '';

type Actor = {
  uid: string;
  role: StoreRole;
  legacyStoreId: string;
  canonicalStoreId: string;
};

const resolveActor = async (authorization: string, legacyStoreId: string): Promise<Actor> => {
  if (!safeStoreId(legacyStoreId)) throw new Error('STAFF_NOTICE_STORE_INVALID');
  const token = bearer(authorization);
  if (!token) throw new Error('AUTH_REQUIRED');
  const identity = await verifyFirebaseIdToken(token);
  const tenant = await adminDb.doc('tenants/' + legacyStoreId).get();
  const canonicalStoreId = clean(tenant.get('canonicalStoreId'));
  if (!safeStoreId(canonicalStoreId)) throw new Error('STAFF_NOTICE_STORE_INVALID');
  const store = await adminDb.doc('stores/' + canonicalStoreId).get();
  if (!store.exists || clean(store.get('ownerId')) !== legacyStoreId) {
    throw new Error('STAFF_NOTICE_STORE_INVALID');
  }
  if (identity.uid === legacyStoreId) {
    return { uid: identity.uid, role: 'owner', legacyStoreId, canonicalStoreId };
  }
  const member = await adminDb.doc(`stores/${canonicalStoreId}/members/${identity.uid}`).get();
  const parsed = parseStoreMember(member.data());
  if (!parsed || parsed.userId !== identity.uid || parsed.storeId !== canonicalStoreId || parsed.status !== 'active') {
    throw new Error('STAFF_NOTICE_FORBIDDEN');
  }
  return { uid: identity.uid, role: parsed.role, legacyStoreId, canonicalStoreId };
};

const collectionFor = (actor: Actor) =>
  adminDb.collection(`stores/${actor.canonicalStoreId}/staffNotices`);

const ensureManager = (actor: Actor): void => {
  if (actor.role !== 'owner' && actor.role !== 'manager') {
    throw new Error('STAFF_NOTICE_FORBIDDEN');
  }
};

export const listAuthorizedStaffNotices = async (input: {
  authorization: string;
  legacyStoreId: string;
}): Promise<StaffNoticeForViewer[]> => {
  const actor = await resolveActor(input.authorization, input.legacyStoreId);
  const snapshot = await collectionFor(actor)
    .orderBy('createdAt', 'desc').limit(STAFF_NOTICE_MAX_RESULTS).get();
  const visible = snapshot.docs.map(doc => doc.data() as StaffNotice).filter(item =>
    item.canonicalStoreId === actor.canonicalStoreId &&
    item.legacyStoreId === actor.legacyStoreId &&
    item.status === 'published' &&
    (actor.role === 'owner' || actor.role === 'manager' || canReadStaffNotice(actor.role, item))
  );
  const receipts = await Promise.all(visible.map(notice =>
    collectionFor(actor).doc(notice.id).collection('readReceipts').doc(actor.uid).get()
  ));
  return visible.map((notice, i) => ({
    ...notice,
    readAt: clean(receipts[i].get('readAt')),
  }));
};

export const publishAuthorizedStaffNotice = async (input: {
  authorization: string;
  legacyStoreId: string;
  requestId: unknown;
  title: unknown;
  body: unknown;
  audienceRoles: unknown;
}): Promise<StaffNotice> => {
  const actor = await resolveActor(input.authorization, input.legacyStoreId);
  ensureManager(actor);
  const valid = validateStaffNoticeInput(input);
  const noticeRef = collectionFor(actor).doc(valid.id);
  // Discover candidate recipients only from this canonical store; never accept
  // recipients or author IDs from the browser. Bounded to avoid fan-out abuse.
  const memberSnapshot = await adminDb.collection(`stores/${actor.canonicalStoreId}/members`)
    .where('status', '==', 'active').limit(STAFF_NOTICE_MAX_MEMBERS + 1).get();
  if (memberSnapshot.size > STAFF_NOTICE_MAX_MEMBERS) {
    throw new Error('STAFF_NOTICE_TEAM_LIMIT');
  }
  const now = new Date().toISOString();
  const notice: StaffNotice = {
    id: valid.id,
    canonicalStoreId: actor.canonicalStoreId,
    legacyStoreId: actor.legacyStoreId,
    title: valid.title,
    body: valid.body,
    audienceRoles: valid.audienceRoles,
    publishedBy: actor.uid,
    createdAt: now,
    status: 'published',
  };
  return adminDb.runTransaction(async tx => {
    const previous = await tx.get(noticeRef);
    // A manager may lose access between the initial token check and the
    // transaction. Validate the current membership inside the same snapshot
    // used for the publication, before any notice or notification writes.
    if (actor.role !== 'owner') {
      const actorMembership = await tx.get(
        adminDb.doc(`stores/${actor.canonicalStoreId}/members/${actor.uid}`)
      );
      const currentActor = parseStoreMember(actorMembership.data());
      if (!currentActor || currentActor.userId !== actor.uid ||
          currentActor.storeId !== actor.canonicalStoreId ||
          currentActor.status !== 'active' || currentActor.role !== 'manager') {
        throw new Error('STAFF_NOTICE_FORBIDDEN');
      }
    }
    if (previous.exists) {
      const existing = previous.data() as StaffNotice;
      if (existing.publishedBy !== actor.uid ||
          existing.title !== notice.title || existing.body !== notice.body ||
          JSON.stringify(existing.audienceRoles) !== JSON.stringify(notice.audienceRoles)) {
        throw new Error('STAFF_NOTICE_IDEMPOTENCY_CONFLICT');
      }
      return existing;
    }

    // Re-read each membership inside the transaction so a recently suspended
    // employee cannot receive the body through a stale fan-out snapshot.
    const currentMemberships = await Promise.all(memberSnapshot.docs.map(doc => tx.get(doc.ref)));
    const recipients = currentMemberships.filter(doc => {
      const member = parseStoreMember(doc.data());
      return member?.status === 'active' && member.userId === doc.id &&
        member.storeId === actor.canonicalStoreId &&
        doc.id !== actor.uid && canReadStaffNotice(member.role, notice);
    });
    tx.create(noticeRef, notice);
    for (const recipient of recipients) {
      const notification = buildUserNotification({
        recipientUserId: recipient.id,
        category: 'system',
        eventType: 'staff_notice_published',
        sourceId: actor.canonicalStoreId + '_' + valid.id,
        actorPrincipalId: actor.uid,
        title: 'Novo aviso da equipe: ' + notice.title,
        body: 'Acesse o Painel da Loja → Ponto → Avisos para ler e confirmar o comunicado.',
        target: { kind: 'none', storeId: actor.canonicalStoreId },
        createdAt: now,
      });
      tx.set(adminDb.doc(userNotificationPath(recipient.id, notification.id)), notification);
    }
    return notice;
  });
};

export const acknowledgeAuthorizedStaffNotice = async (input: {
  authorization: string;
  legacyStoreId: string;
  noticeId: string;
}): Promise<string> => {
  const actor = await resolveActor(input.authorization, input.legacyStoreId);
  const noticeId = clean(input.noticeId);
  if (!isSafeStaffNoticeId(noticeId)) throw new Error('STAFF_NOTICE_INVALID');
  const noticeRef = collectionFor(actor).doc(noticeId);
  const receiptRef = noticeRef.collection('readReceipts').doc(actor.uid);
  return adminDb.runTransaction(async tx => {
    const [noticeDoc, existing] = await Promise.all([
      tx.get(noticeRef), tx.get(receiptRef),
    ]);
    const notice = noticeDoc.data() as StaffNotice | undefined;
    if (!notice || notice.legacyStoreId !== actor.legacyStoreId ||
        notice.canonicalStoreId !== actor.canonicalStoreId ||
        !canReadStaffNotice(actor.role, notice)) {
      throw new Error('STAFF_NOTICE_NOT_FOUND');
    }
    const prior = clean(existing.get('readAt'));
    if (prior) return prior;
    const readAt = new Date().toISOString();
    tx.set(receiptRef, { userId: actor.uid, readAt, noticeId });
    return readAt;
  });
};
