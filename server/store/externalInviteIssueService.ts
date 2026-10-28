import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { authorizeExternalTeamInvitation } from './externalInviteAuthority.js';
import { generateExternalInviteToken } from './externalInvitePrimitives.js';

const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/** Server-only issuance. No delivery or public endpoint is enabled by this service. */
export const issueExternalTeamInvitation = async (input: {
  storeId: string;
  actorUserId: string;
  recipientEmail: string;
  invitedRole: unknown;
}): Promise<{ invitationId: string; token: string; expiresAt: string }> => {
  const authority = await authorizeExternalTeamInvitation(input);
  const invitationId = randomUUID();
  const { token, hash } = generateExternalInviteToken();
  const now = Date.now();
  const expiresAt = now + INVITE_LIFETIME_MS;
  const invitationRef = adminDb.doc(`stores/${authority.storeId}/externalTeamInvitations/${invitationId}`);
  const storeRef = adminDb.doc(`stores/${authority.storeId}`);
  const actorRef = adminDb.doc(`stores/${authority.storeId}/members/${authority.actorUserId}`);

  await adminDb.runTransaction(async transaction => {
    // Revalidate permissions inside the write transaction to close revocation races.
    const store = await transaction.get(storeRef);
    if (!store.exists) throw new Error('TEAM_INVITE_STORE_NOT_FOUND');
    if (store.get('ownerId') !== authority.actorUserId) {
      const member = await transaction.get(actorRef);
      if (!member.exists || member.get('status') !== 'active' || member.get('role') !== authority.actorRole) {
        throw new Error('TEAM_INVITE_FORBIDDEN');
      }
    }
    if (store.get('ownerId') === authority.actorUserId && authority.actorRole !== 'owner') {
      throw new Error('TEAM_INVITE_FORBIDDEN');
    }
    transaction.create(invitationRef, {
      storeId: authority.storeId,
      storeName: authority.storeName,
      invitedBy: authority.actorUserId,
      recipientEmail: authority.recipientEmail,
      role: authority.invitedRole,
      tokenHash: hash,
      status: 'issued',
      createdAt: Timestamp.fromMillis(now),
      expiresAt: Timestamp.fromMillis(expiresAt),
    });
  });

  return { invitationId, token, expiresAt: new Date(expiresAt).toISOString() };
};
