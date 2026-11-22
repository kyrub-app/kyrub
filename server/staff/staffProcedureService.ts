import { createHash } from 'node:crypto';
import { adminDb, adminStorage, getFirebaseAdminProjectId } from '../firebaseAdmin.js';
import { parseStoreMember } from '../../src/utils/storeSecurity.js';
import { buildUserNotification, userNotificationPath } from '../../shared/userNotifications.js';
import { resolveStaffActor } from './staffNoticeService.js';
import {
  STAFF_POP_MAX_ATTACHMENT_BYTES,
  STAFF_POP_MAX_RESULTS,
  STAFF_POP_MAX_VERSIONS,
  canReadStaffPop,
  safePopId,
  safePopVersion,
  validateStaffPopAttachment,
  validateStaffPopPublication,
  type StaffPopAttachment,
  type StaffProcedure,
  type StaffProcedureRevision,
  type StaffProcedureView,
} from '../../shared/staffProcedures.js';

const clean = (v: unknown): string => typeof v === 'string' ? v.trim() : '';
type Actor = Awaited<ReturnType<typeof resolveStaffActor>>;
const requireManager = (actor: Actor): void => {
  if (actor.role !== 'owner' && actor.role !== 'manager') throw Error('STAFF_POP_FORBIDDEN');
};
const procedures = (actor: Actor) => adminDb.collection(
  'stores/' + actor.canonicalStoreId + '/staffProcedures'
);
const ensureActorStillActive = async (
  actor: Actor,
  tx: FirebaseFirestore.Transaction
): Promise<void> => {
  if (actor.role === 'owner') return;
  const snap = await tx.get(adminDb.doc(
    'stores/' + actor.canonicalStoreId + '/members/' + actor.uid
  ));
  const current = parseStoreMember(snap.data());
  if (!current || current.userId !== actor.uid ||
      current.storeId !== actor.canonicalStoreId || current.status !== 'active' ||
      current.role !== actor.role) throw Error('STAFF_POP_FORBIDDEN');
};

const privateBucket = () =>
  adminStorage.bucket(getFirebaseAdminProjectId() + '.firebasestorage.app');

export const listAuthorizedStaffProcedures = async (input: {
  authorization: string;
  legacyStoreId: string;
}): Promise<StaffProcedureView[]> => {
  const actor = await resolveStaffActor(input.authorization, input.legacyStoreId);
  const result = await procedures(actor).orderBy('publishedAt', 'desc')
    .limit(STAFF_POP_MAX_RESULTS).get();
  const accessible = result.docs.map(doc => doc.data() as StaffProcedure)
    .filter(pop => pop.canonicalStoreId === actor.canonicalStoreId &&
      pop.legacyStoreId === actor.legacyStoreId &&
      canReadStaffPop(actor.role, pop));
  const views = await Promise.all(accessible.map(async pop => {
    const versionRef = procedures(actor).doc(pop.id)
      .collection('versions').doc(String(pop.currentVersion));
    const [revisionSnap, receipt] = await Promise.all([
      versionRef.get(), versionRef.collection('readReceipts').doc(actor.uid).get(),
    ]);
    const revision = revisionSnap.data() as StaffProcedureRevision | undefined;
    if (!revision || revision.version !== pop.currentVersion ||
        revision.id !== pop.id) return null;
    return { ...pop, revision, readAt: clean(receipt.get('readAt')) };
  }));
  return views.filter((item): item is StaffProcedureView => item !== null);
};

const hasExpectedMagic = (mimeType: string, bytes: Buffer): boolean => {
  if (mimeType === 'application/pdf') return bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mimeType === 'image/jpeg') return bytes.length > 3 &&
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === 'image/png') return bytes.length > 8 &&
    bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  if (mimeType === 'image/webp') return bytes.length > 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  return false;
};

export const uploadAuthorizedStaffPopFile = async (input: {
  authorization: string;
  legacyStoreId: string;
  procedureId: unknown;
  requestId: unknown;
  name: unknown;
  mimeType: unknown;
  dataBase64: unknown;
}): Promise<StaffPopAttachment> => {
  const actor = await resolveStaffActor(input.authorization, input.legacyStoreId);
  requireManager(actor);
  const procedureId = clean(input.procedureId), requestId = clean(input.requestId);
  const name = clean(input.name), mimeType = clean(input.mimeType);
  const base64 = clean(input.dataBase64);
  if (!safePopId(procedureId) || !safePopId(requestId) ||
      !name || name.length > 160 ||
      !['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(mimeType) ||
      base64.length < 8 || base64.length > 2100000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw Error('STAFF_POP_ATTACHMENT_INVALID');
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > STAFF_POP_MAX_ATTACHMENT_BYTES ||
      bytes.toString('base64') !== base64 ||
      !hasExpectedMagic(mimeType, bytes)) throw Error('STAFF_POP_ATTACHMENT_INVALID');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const path = 'staff-pops/' + actor.canonicalStoreId + '/' + procedureId +
    '/' + requestId + '/' + sha256;
  const attachment = validateStaffPopAttachment({
    path, name, mimeType, sizeBytes: bytes.length, sha256,
  }, actor.canonicalStoreId, procedureId, requestId)!;
  const file = privateBucket().file(path);
  const [exists] = await file.exists();
  if (!exists) {
    try {
      await file.save(bytes, {
        resumable: false,
        contentType: mimeType,
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: {
          cacheControl: 'private, no-store',
          contentDisposition: 'attachment',
          metadata: {
            uploadedBy: actor.uid,
            sha256, procedureId, requestId, canonicalStoreId: actor.canonicalStoreId,
          },
        },
      });
    } catch (error) {
      const [created] = await file.exists();
      if (!created) throw error;
    }
  }
  const [saved] = await file.getMetadata();
  if (saved.metadata?.uploadedBy !== actor.uid ||
      saved.metadata?.sha256 !== sha256 ||
      saved.metadata?.canonicalStoreId !== actor.canonicalStoreId ||
      saved.metadata?.procedureId !== procedureId ||
      saved.metadata?.requestId !== requestId ||
      saved.contentType !== mimeType || Number(saved.size) !== bytes.length) {
    throw Error('STAFF_POP_ATTACHMENT_INVALID');
  }
  return attachment;
};

const verifyAttachment = async (
  actor: Actor, procedureId: string, requestId: string, raw: unknown
): Promise<StaffPopAttachment | null> => {
  const attachment = validateStaffPopAttachment(
    raw, actor.canonicalStoreId, procedureId, requestId
  );
  if (!attachment) return null;
  const file = privateBucket().file(attachment.path);
  const [exists] = await file.exists();
  if (!exists) throw Error('STAFF_POP_ATTACHMENT_INVALID');
  const [saved] = await file.getMetadata();
  if (saved.metadata?.uploadedBy !== actor.uid ||
      saved.metadata?.sha256 !== attachment.sha256 ||
      saved.metadata?.canonicalStoreId !== actor.canonicalStoreId ||
      saved.contentType !== attachment.mimeType ||
      Number(saved.size) !== attachment.sizeBytes) throw Error('STAFF_POP_ATTACHMENT_INVALID');
  return attachment;
};

export const publishAuthorizedStaffProcedure = async (input: {
  authorization: string; legacyStoreId: string;
  procedureId: unknown; requestId: unknown; expectedVersion: unknown;
  title: unknown; body: unknown; audienceRoles: unknown; attachment: unknown;
}): Promise<StaffProcedure> => {
  const actor = await resolveStaffActor(input.authorization, input.legacyStoreId);
  requireManager(actor);
  const validated = validateStaffPopPublication(input);
  const attachment = await verifyAttachment(
    actor, validated.procedureId, validated.requestId, input.attachment
  );
  if (!validated.body && !attachment) throw Error('STAFF_POP_INVALID');
  const ref = procedures(actor).doc(validated.procedureId);
  const members = await adminDb.collection(
    'stores/' + actor.canonicalStoreId + '/members'
  ).where('status', '==', 'active').limit(121).get();
  if (members.size > 120) throw Error('STAFF_POP_TEAM_LIMIT');
  const now = new Date().toISOString();
  return adminDb.runTransaction(async tx => {
    const parentSnap = await tx.get(ref);
    await ensureActorStillActive(actor, tx);
    const previous = parentSnap.data() as StaffProcedure | undefined;
    if (previous) {
      if (previous.lastRequestId === validated.requestId) return previous;
      if (previous.canonicalStoreId !== actor.canonicalStoreId ||
          previous.legacyStoreId !== actor.legacyStoreId ||
          previous.currentVersion !== validated.expectedVersion) {
        throw Error('STAFF_POP_VERSION_CONFLICT');
      }
    } else if (validated.expectedVersion !== 0) {
      throw Error('STAFF_POP_VERSION_CONFLICT');
    }
    const version = (previous?.currentVersion ?? 0) + 1;
    if (version > STAFF_POP_MAX_VERSIONS) throw Error('STAFF_POP_VERSION_LIMIT');
    const currentMembers = await Promise.all(members.docs.map(doc => tx.get(doc.ref)));
    const recipients = currentMembers.filter(doc => {
      const member = parseStoreMember(doc.data());
      return member?.status === 'active' && member.storeId === actor.canonicalStoreId &&
        member.userId === doc.id && doc.id !== actor.uid &&
        canReadStaffPop(member.role, {status: 'published', audienceRoles: validated.audienceRoles});
    });
    const revision: StaffProcedureRevision = {
      id: validated.procedureId, version, requestId: validated.requestId,
      title: validated.title, body: validated.body,
      audienceRoles: validated.audienceRoles,
      attachment, publishedBy: actor.uid, publishedAt: now,
    };
    const summary: StaffProcedure = {
      id: validated.procedureId, legacyStoreId: actor.legacyStoreId,
      canonicalStoreId: actor.canonicalStoreId, title: validated.title,
      currentVersion: version, audienceRoles: validated.audienceRoles,
      lastRequestId: validated.requestId, publishedBy: actor.uid,
      publishedAt: now, status: 'published',
    };
    const versionRef = ref.collection('versions').doc(String(version));
    if (previous) tx.update(ref, summary as unknown as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>);
    else tx.create(ref, summary);
    tx.create(versionRef, revision);
    for (const member of recipients) {
      const notification = buildUserNotification({
        recipientUserId: member.id,
        category: 'system',
        eventType: 'staff_pop_published',
        sourceId: actor.canonicalStoreId + '_' + validated.procedureId + '_v' + version,
        actorPrincipalId: actor.uid,
        title: 'Manual POP ' + (version === 1 ? 'publicado: ' : 'atualizado: ') + validated.title,
        body: 'Consulte a versão ' + version + ' em Painel da Loja → Ponto → Manuais POP e confirme a leitura.',
        target: { kind: 'none', storeId: actor.canonicalStoreId },
        createdAt: now,
      });
      tx.set(adminDb.doc(userNotificationPath(member.id, notification.id)), notification);
    }
    return summary;
  });
};

export const acknowledgeAuthorizedStaffPop = async (input: {
  authorization: string; legacyStoreId: string;
  procedureId: string; version: number;
}): Promise<string> => {
  const actor = await resolveStaffActor(input.authorization, input.legacyStoreId);
  if (!safePopId(input.procedureId) || !safePopVersion(input.version) || input.version === 0) {
    throw Error('STAFF_POP_INVALID');
  }
  const ref = procedures(actor).doc(input.procedureId);
  const versionRef = ref.collection('versions').doc(String(input.version));
  const receipt = versionRef.collection('readReceipts').doc(actor.uid);
  return adminDb.runTransaction(async tx => {
    const [parent, revision, previousReceipt] = await Promise.all([
      tx.get(ref), tx.get(versionRef), tx.get(receipt),
    ]);
    await ensureActorStillActive(actor, tx);
    const data = parent.data() as StaffProcedure | undefined;
    if (!data || !revision.exists || data.currentVersion !== input.version ||
        data.canonicalStoreId !== actor.canonicalStoreId ||
        data.legacyStoreId !== actor.legacyStoreId ||
        !canReadStaffPop(actor.role, data)) throw Error('STAFF_POP_NOT_FOUND');
    const existing = clean(previousReceipt.get('readAt'));
    if (existing) return existing;
    const readAt = new Date().toISOString();
    tx.create(receipt, {
      procedureId: input.procedureId, version: input.version,
      userId: actor.uid, readAt,
    });
    return readAt;
  });
};

export const readAuthorizedStaffPopAttachment = async (input: {
  authorization: string; legacyStoreId: string;
  procedureId: string; version: number;
}): Promise<{ bytes: Buffer; name: string; mimeType: string }> => {
  const actor = await resolveStaffActor(input.authorization, input.legacyStoreId);
  if (!safePopId(input.procedureId) || !safePopVersion(input.version) || input.version === 0) {
    throw Error('STAFF_POP_INVALID');
  }
  const ref = procedures(actor).doc(input.procedureId);
  const [parentSnap, revisionSnap] = await Promise.all([
    ref.get(), ref.collection('versions').doc(String(input.version)).get(),
  ]);
  const parent = parentSnap.data() as StaffProcedure | undefined;
  const revision = revisionSnap.data() as StaffProcedureRevision | undefined;
  if (!parent || !revision || parent.canonicalStoreId !== actor.canonicalStoreId ||
      parent.legacyStoreId !== actor.legacyStoreId ||
      !canReadStaffPop(actor.role, parent) ||
      (actor.role !== 'owner' && actor.role !== 'manager' &&
        input.version !== parent.currentVersion)) throw Error('STAFF_POP_NOT_FOUND');
  const attachment = revision.attachment;
  if (!attachment) throw Error('STAFF_POP_NOT_FOUND');
  const expectedPath = 'staff-pops/' + actor.canonicalStoreId + '/' + input.procedureId +
    '/' + revision.requestId + '/' + attachment.sha256;
  if (attachment.path !== expectedPath) throw Error('STAFF_POP_NOT_FOUND');
  const [bytes] = await privateBucket().file(attachment.path).download();
  if (bytes.length !== attachment.sizeBytes ||
      createHash('sha256').update(bytes).digest('hex') !== attachment.sha256) {
    throw Error('STAFF_POP_ATTACHMENT_INVALID');
  }
  return { bytes, name: attachment.name, mimeType: attachment.mimeType };
};

export const listAuthorizedStaffPopHistory = async (input: {
  authorization: string; legacyStoreId: string; procedureId: string;
}): Promise<StaffProcedureRevision[]> => {
  const actor = await resolveStaffActor(input.authorization, input.legacyStoreId);
  requireManager(actor);
  if (!safePopId(input.procedureId)) throw Error('STAFF_POP_INVALID');
  const ref = procedures(actor).doc(input.procedureId);
  const parent = await ref.get();
  if (!parent.exists || parent.get('legacyStoreId') !== actor.legacyStoreId) throw Error('STAFF_POP_NOT_FOUND');
  const versions = await ref.collection('versions').orderBy('version', 'desc')
    .limit(STAFF_POP_MAX_VERSIONS).get();
  return versions.docs.map(doc => doc.data() as StaffProcedureRevision);
};
