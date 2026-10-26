import { adminDb } from '../firebaseAdmin.js';

type Decision = 'accepted' | 'declined';

const validId = (value: string): boolean =>
  Boolean(value) && value.length <= 160 && !value.includes('/') && value !== '.' && value !== '..';

/**
 * Trusted membership transition. Never accepts an invitee UID from request data:
 * the authenticated Firebase identity is the sole recipient.
 */
export async function respondToCommunityGroupInvitation(input: {
  groupId: string;
  recipientUserId: string;
  decision: Decision;
}): Promise<{ status: Decision }> {
  const { groupId, recipientUserId, decision } = input;
  if (!validId(groupId) || !validId(recipientUserId) ||
    (decision !== 'accepted' && decision !== 'declined')) {
    throw new Error('COMMUNITY_GROUP_INVITATION_INVALID');
  }
  const groupRef = adminDb.doc(`community_groups/${groupId}`);
  const inviteRef = groupRef.collection('invitations').doc(recipientUserId);
  return adminDb.runTransaction(async transaction => {
    const [groupSnap, inviteSnap] = await transaction.getAll(groupRef, inviteRef);
    if (!groupSnap.exists || !inviteSnap.exists) {
      throw new Error('COMMUNITY_GROUP_INVITATION_NOT_FOUND');
    }
    const group = groupSnap.data()!;
    const invite = inviteSnap.data()!;
    if (invite.inviteeId !== recipientUserId ||
      invite.invitedBy !== group.creatorId ||
      invite.status !== 'pending') {
      throw new Error('COMMUNITY_GROUP_INVITATION_NOT_PENDING');
    }
    const communityId = group.communityId;
    if (!validId(communityId) || !Array.isArray(group.memberIds) ||
      !group.memberIds.includes(group.creatorId) ||
      group.memberIds.length >= 50) {
      throw new Error('COMMUNITY_GROUP_INVITATION_INVALID');
    }
    const membershipRef = adminDb.doc(`community_members/${communityId}__${recipientUserId}`);
    const membershipSnap = await transaction.get(membershipRef);
    if (membershipSnap.data()?.status !== 'active' ||
      membershipSnap.data()?.communityId !== communityId ||
      membershipSnap.data()?.userId !== recipientUserId) {
      throw new Error('COMMUNITY_GROUP_MEMBERSHIP_REQUIRED');
    }
    if (decision === 'accepted') {
      if (group.memberIds.includes(recipientUserId)) {
        throw new Error('COMMUNITY_GROUP_INVITATION_NOT_PENDING');
      }
      transaction.update(groupRef, {
        memberIds: [...group.memberIds, recipientUserId],
        updatedAt: new Date(),
      });
    }
    transaction.update(inviteRef, { status: decision });
    return { status: decision };
  });
}
