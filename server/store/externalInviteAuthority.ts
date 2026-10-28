import { adminDb } from '../firebaseAdmin.js';
import { canAssignStoreRole, isStoreRole, type StoreRole } from '../../src/utils/storeSecurity.js';
import { normalizeExternalInviteEmail } from './externalInvitePrimitives.js';

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

export type ExternalTeamInviteAuthority = {
  storeId: string;
  storeName: string;
  actorUserId: string;
  actorRole: 'owner' | 'manager';
  recipientEmail: string;
  invitedRole: Exclude<StoreRole, 'owner'>;
};

/** Server-side authority check. Never trust a role sent from the browser. */
export const authorizeExternalTeamInvitation = async (input: {
  storeId: string;
  actorUserId: string;
  recipientEmail: string;
  invitedRole: unknown;
}): Promise<ExternalTeamInviteAuthority> => {
  const storeId = clean(input.storeId);
  const actorUserId = clean(input.actorUserId);
  const recipientEmail = normalizeExternalInviteEmail(input.recipientEmail);
  if (!storeId || !actorUserId || !recipientEmail || !isStoreRole(input.invitedRole) || input.invitedRole === 'owner') {
    throw new Error('TEAM_INVITE_INVALID_INPUT');
  }
  const store = await adminDb.doc(`stores/${storeId}`).get();
  if (!store.exists) throw new Error('TEAM_INVITE_STORE_NOT_FOUND');
  const data = store.data() ?? {};
  let actorRole: 'owner' | 'manager' | null = null;
  if (data.ownerId === actorUserId) {
    actorRole = 'owner';
  } else {
    const member = await adminDb.doc(`stores/${storeId}/members/${actorUserId}`).get();
    if (member.exists && member.get('status') === 'active' && member.get('role') === 'manager') {
      actorRole = 'manager';
    }
  }
  if (!actorRole || !canAssignStoreRole(actorRole, input.invitedRole)) {
    throw new Error('TEAM_INVITE_FORBIDDEN');
  }
  return {
    storeId,
    storeName: clean(data.name),
    actorUserId,
    actorRole,
    recipientEmail,
    invitedRole: input.invitedRole,
  };
};
