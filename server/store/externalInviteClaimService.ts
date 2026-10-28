import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { externalInviteClaimEligible, verifyExternalInviteToken } from './externalInvitePrimitives.js';

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

/** Claim only links a verified recipient to the existing canonical invitation inbox. */
export const claimExternalTeamInvitation = async (input: {
  storeId: string;
  invitationId: string;
  token: string;
  recipientUserId: string;
  authenticatedEmail: string;
  emailVerified: boolean;
  displayName?: string;
}): Promise<{ storeId: string; status: 'invited' }> => {
  const storeId = clean(input.storeId);
  const invitationId = clean(input.invitationId);
  const uid = clean(input.recipientUserId);
  if (!/^[^/]{1,128}$/.test(storeId) || !/^[0-9a-f-]{36}$/i.test(invitationId) || !uid || uid.includes('/')) {
    throw new Error('TEAM_INVITE_INVALID_INPUT');
  }
  const inviteRef = adminDb.doc(`stores/${storeId}/externalTeamInvitations/${invitationId}`);
  const memberRef = adminDb.doc(`stores/${storeId}/members/${uid}`);
  const now = Date.now();
  await adminDb.runTransaction(async transaction => {
    const invite = await transaction.get(inviteRef);
    const member = await transaction.get(memberRef);
    if (!invite.exists) throw new Error('TEAM_INVITE_UNAVAILABLE');
    const data = invite.data() ?? {};
    const expiry = data.expiresAt instanceof Timestamp ? data.expiresAt.toMillis() : NaN;
    if (
      data.storeId !== storeId ||
      !verifyExternalInviteToken(input.token, clean(data.tokenHash)) ||
      !externalInviteClaimEligible({
        invitationEmail: clean(data.recipientEmail),
        authenticatedEmail: input.authenticatedEmail,
        emailVerified: input.emailVerified,
        status: clean(data.status),
        expiresAt: expiry,
        now,
      })
    ) {
      throw new Error('TEAM_INVITE_UNAVAILABLE');
    }
    if (member.exists) throw new Error('TEAM_INVITE_MEMBERSHIP_EXISTS');
    const timestamp = Timestamp.fromMillis(now);
    transaction.create(memberRef, {
      storeId,
      storeName: clean(data.storeName),
      userId: uid,
      displayName: clean(input.displayName) || input.authenticatedEmail.split('@')[0],
      email: input.authenticatedEmail,
      photoUrl: '',
      role: data.role,
      jobTitle: '',
      department: '',
      workArea: '',
      status: 'invited',
      invitedBy: data.invitedBy,
      invitedAt: timestamp,
      acceptedAt: '',
      suspendedAt: '',
      removedAt: '',
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    transaction.update(inviteRef, { status: 'claimed', claimedBy: uid, claimedAt: timestamp });
  });
  return { storeId, status: 'invited' };
};
