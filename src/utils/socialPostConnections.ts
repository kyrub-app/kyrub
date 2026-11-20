import type { Friend } from '../types';
import type { CommunityPostConnection } from './communityPostConnections';

/** A post's author identity is the Firebase UID, never their display name. */
type PostAuthor = {
  authorId?: string;
  user: string;
  avatar: string;
};

export type PostAuthorConnectionState =
  | 'accepted'
  | 'pending_sent'
  | 'pending_received'
  | 'none';

/**
 * Unifies post actions with the canonical accepted /connections relation.
 * The same Friend payload is consumed by ChatModal in the Conectados tab.
 * A pending connection, a name match or a suggestion never unlocks chat.
 */
export function resolvePostAuthorConnection(
  viewerId: string,
  post: PostAuthor,
  friends: readonly Friend[],
  connections: readonly CommunityPostConnection[],
): { status: PostAuthorConnectionState; friend: Friend | null } {
  const authorId = post.authorId;
  if (!viewerId || !authorId || authorId === viewerId) {
    return { status: 'none', friend: null };
  }

  const canonical = connections.find(connection =>
    Boolean(connection.id) &&
    ((connection.senderId === viewerId && connection.receiverId === authorId) ||
     (connection.senderId === authorId && connection.receiverId === viewerId))
  );
  if (canonical?.status === 'pending') {
    return {
      status: canonical.senderId === viewerId ? 'pending_sent' : 'pending_received',
      friend: null,
    };
  }

  const connectedFriend = friends.find(friend =>
    friend.id === authorId &&
    friend.added &&
    friend.connectionStatus === 'accepted' &&
    Boolean(friend.connectionId)
  );

  if (canonical?.status === 'accepted' || (!canonical && connectedFriend)) {
    const id = canonical?.id || connectedFriend?.connectionId;
    if (!id) return { status: 'none', friend: null };
    const displayFriend: Friend = {
      id: authorId,
      name: connectedFriend?.name || post.user ||
        (canonical?.senderId === viewerId ? canonical.receiverName : canonical?.senderName) ||
        'Kairubido',
      role: connectedFriend?.role || 'Cliente',
      avatar: connectedFriend?.avatar || post.avatar || '',
      bio: connectedFriend?.bio || '',
      favorited: connectedFriend?.favorited ?? false,
      isProfileVisible: connectedFriend?.isProfileVisible ?? true,
      added: true,
      connectionStatus: 'accepted',
      connectionId: id,
    };
    return { status: 'accepted', friend: displayFriend };
  }
  return { status: 'none', friend: null };
}
