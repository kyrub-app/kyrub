import { adminDb } from '../firebaseAdmin.js';
import { buildUserNotification, userNotificationPath } from '../../shared/userNotifications.js';

const validId = (value: string): boolean =>
  Boolean(value) && value.length <= 160 && !value.includes('/') && value !== '.' && value !== '..';

export async function issueCommunityGroupInvitation(input: {
  groupId: string;
  inviterUserId: string;
  inviteeUserId: string;
}): Promise<{ status: 'pending'; created: boolean }> {
  const { groupId, inviterUserId, inviteeUserId } = input;
  if (![groupId, inviterUserId, inviteeUserId].every(validId) || inviterUserId === inviteeUserId) {
    throw new Error('COMMUNITY_GROUP_INVITATION_INVALID');
  }
  const groupRef = adminDb.doc(`community_groups/${groupId}`);
  const inviteRef = groupRef.collection('invitations').doc(inviteeUserId);
  return adminDb.runTransaction(async transaction => {
    const [groupSnap, inviteSnap] = await transaction.getAll(groupRef, inviteRef);
    if (!groupSnap.exists) throw new Error('COMMUNITY_GROUP_INVITATION_NOT_FOUND');
    const group = groupSnap.data()!;
    const communityId = group.communityId;
    if (!validId(communityId) || group.creatorId !== inviterUserId ||
      !Array.isArray(group.memberIds) || !group.memberIds.includes(inviterUserId) ||
      group.memberIds.includes(inviteeUserId) || group.memberIds.length >= 50) {
      throw new Error('COMMUNITY_GROUP_INVITATION_FORBIDDEN');
    }
    const inviterMemberRef = adminDb.doc(`community_members/${communityId}__${inviterUserId}`);
    const inviteeMemberRef = adminDb.doc(`community_members/${communityId}__${inviteeUserId}`);
    const [inviterMember, inviteeMember] = await transaction.getAll(inviterMemberRef, inviteeMemberRef);
    for (const [snapshot, uid] of [[inviterMember, inviterUserId], [inviteeMember, inviteeUserId]] as const) {
      if (snapshot.data()?.status !== 'active' || snapshot.data()?.communityId !== communityId ||
        snapshot.data()?.userId !== uid) {
        throw new Error('COMMUNITY_GROUP_MEMBERSHIP_REQUIRED');
      }
    }
    if (inviteSnap.exists) {
      if (inviteSnap.data()?.status === 'pending') return { status: 'pending' as const, created: false };
      throw new Error('COMMUNITY_GROUP_INVITATION_NOT_PENDING');
    }
    const now = new Date().toISOString();
    const notification = buildUserNotification({
      recipientUserId: inviteeUserId,
      category: 'community_group_invite',
      eventType: 'invited',
      sourceId: `${groupId}_${inviteeUserId}`,
      actorPrincipalId: inviterUserId,
      title: 'Convite para grupo',
      body: `Você recebeu um convite para participar de ${String(group.name || 'um grupo').slice(0, 80)}.`,
      target: { kind: 'community_group_invite', communityId, groupId },
      createdAt: now,
    });
    transaction.create(inviteRef, {
      inviteeId: inviteeUserId,
      invitedBy: inviterUserId,
      status: 'pending',
      createdAt: new Date(now),
    });
    transaction.create(adminDb.doc(userNotificationPath(inviteeUserId, notification.id)), notification);
    return { status: 'pending' as const, created: true };
  });
}
