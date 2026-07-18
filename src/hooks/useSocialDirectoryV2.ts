import { useEffect, useState } from 'react';
import { db, auth } from '../utils/firebase';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from 'firebase/firestore';
import { Friend } from '../types';

const STORAGE_KEYS = {
  FAVORITE_STORES: 'kyrub_favorite_stores'
};

type ConnectionDocument = {
  id: string;
  senderId: string;
  receiverId: string;
  participantIds: string[];
  status: 'pending' | 'accepted';
  senderName?: string;
  senderRole?: string;
  senderAvatar?: string;
  senderBio?: string;
  receiverName?: string;
  receiverRole?: string;
  receiverAvatar?: string;
  receiverBio?: string;
};

const getConnectionId = (firstUid: string, secondUid: string) =>
  [firstUid, secondUid].sort().join('_');

const getUserRole = (user: any) =>
  user?.role ||
  (user?.accountTypes?.lojista
    ? 'Lojista'
    : user?.accountTypes?.entregador
      ? 'Entregador'
      : 'Cliente');

interface UseSocialDirectoryOptions {
  profileName: string;
  profilePhotoUrl: string;
  profileAddress: string;
  accountTypeLojista: boolean;
  accountTypeEntregador: boolean;
  isLoggedIn: boolean;
  triggerToast: (msg: string, type: 'success' | 'error' | 'info' | 'warning') => void;
}

export function useSocialDirectoryV2({
  profileName,
  profilePhotoUrl,
  profileAddress,
  accountTypeLojista,
  accountTypeEntregador,
  isLoggedIn,
  triggerToast
}: UseSocialDirectoryOptions) {
  // Social states
  const [friends, setFriends] = useState<Friend[]>([]);
  const [dbUsers, setDbUsers] = useState<any[]>([]);
  const [connectionRequests, setConnectionRequests] = useState<any[]>([]);
  const [connections, setConnections] = useState<ConnectionDocument[]>([]);

  const [favoriteStoreIds, setFavoriteStoreIds] = useState<string[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.FAVORITE_STORES);
    return saved ? JSON.parse(saved) : ['s-1'];
  });

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEYS.FAVORITE_STORES,
      JSON.stringify(favoriteStoreIds)
    );
  }, [favoriteStoreIds]);

  useEffect(() => {
    const currentUser = auth.currentUser;

    if (!isLoggedIn || !currentUser) {
      setConnections([]);
      return;
    }

    const connectionsQuery = query(
      collection(db, 'connections'),
      where('participantIds', 'array-contains', currentUser.uid)
    );

    return onSnapshot(
      connectionsQuery,
      snapshot => {
        setConnections(
          snapshot.docs.map(snapshotDoc => ({
            id: snapshotDoc.id,
            ...(snapshotDoc.data() as Omit<ConnectionDocument, 'id'>)
          }))
        );
      },
      error => {
        console.error('Falha ao escutar conexões:', error);
        setConnections([]);
      }
    );
  }, [isLoggedIn]);
  useEffect(() => {
    const currentUid = auth.currentUser?.uid;

    if (!isLoggedIn || !currentUid) {
      setFriends([]);
      setConnectionRequests([]);
      return;
    }

    const acceptedConnections = connections.filter(
      connection => connection.status === 'accepted'
    );

    setFriends(previousFriends => {
      const previousById = new Map(
        previousFriends.map(friend => [friend.id, friend])
      );

      return acceptedConnections.map(connection => {
        const currentUserIsSender =
          connection.senderId === currentUid;

        const otherUid = currentUserIsSender
          ? connection.receiverId
          : connection.senderId;

        const dbUser = dbUsers.find(
          user => user.id === otherUid
        );

        const previousFriend = previousById.get(otherUid);

        const snapshotName = currentUserIsSender
          ? connection.receiverName
          : connection.senderName;

        const snapshotRole = currentUserIsSender
          ? connection.receiverRole
          : connection.senderRole;

        const snapshotAvatar = currentUserIsSender
          ? connection.receiverAvatar
          : connection.senderAvatar;

        const snapshotBio = currentUserIsSender
          ? connection.receiverBio
          : connection.senderBio;

        return {
          id: otherUid,
          name:
            dbUser?.name ||
            dbUser?.email ||
            snapshotName ||
            previousFriend?.name ||
            'Usuário do Kyrub',
          role: dbUser
            ? getUserRole(dbUser)
            : snapshotRole ||
            previousFriend?.role ||
            'Cliente',
          added: true,
          avatar:
            dbUser?.photoUrl ||
            snapshotAvatar ||
            previousFriend?.avatar ||
            '',
          bio:
            dbUser?.bio ||
            dbUser?.whatsapp ||
            snapshotBio ||
            previousFriend?.bio ||
            '',
          isProfileVisible:
            dbUser?.isProfileVisible !== false,
          favorited: previousFriend?.favorited ?? false,
          connectionStatus: 'accepted',
          connectionId: connection.id
        };
      });
    });

    const incomingRequests = connections
      .filter(
        connection =>
          connection.status === 'pending' &&
          connection.receiverId === currentUid
      )
      .map(connection => {
        const sender = dbUsers.find(
          user => user.id === connection.senderId
        );

        return {
          id: connection.senderId,
          connectionId: connection.id,
          name:
            sender?.name ||
            sender?.email ||
            connection.senderName ||
            'Usuário do Kyrub',
          role: sender
            ? getUserRole(sender)
            : connection.senderRole || 'Cliente',
          avatar:
            sender?.photoUrl ||
            connection.senderAvatar ||
            '',
          bio:
            sender?.bio ||
            sender?.whatsapp ||
            connection.senderBio ||
            '',
          connectionStatus: 'pending_received'
        };
      });

    setConnectionRequests(incomingRequests);
  }, [connections, dbUsers, isLoggedIn]);

  // Connect / Disconnect Friends
  const handleToggleFriend = async (friendId: string) => {
    const currentUser = auth.currentUser;

    if (!currentUser) {
      triggerToast('Faça login para conectar com outros usuários!', 'error');
      return;
    }

    if (friendId === currentUser.uid) return;

    const connectionId = getConnectionId(currentUser.uid, friendId);
    const existingConnection = connections.find(
      connection => connection.id === connectionId
    );

    try {
      if (existingConnection?.status === 'accepted') {
        await deleteDoc(doc(db, 'connections', connectionId));
        triggerToast('Conexão removida.', 'info');
        return;
      }

      if (existingConnection?.status === 'pending') {
        if (existingConnection.senderId === currentUser.uid) {
          await deleteDoc(doc(db, 'connections', connectionId));
          triggerToast('Solicitação cancelada.', 'info');
        } else {
          triggerToast(
            'Você já recebeu uma solicitação desta pessoa.',
            'info'
          );
        }
        return;
      }

      const targetUser = dbUsers.find(user => user.id === friendId);

      if (!targetUser) {
        triggerToast('Não foi possível localizar este usuário.', 'error');
        return;
      }

      const senderRole = accountTypeLojista
        ? 'Lojista'
        : accountTypeEntregador
          ? 'Entregador'
          : 'Cliente';

      await setDoc(doc(db, 'connections', connectionId), {
        senderId: currentUser.uid,
        receiverId: friendId,
        participantIds: [currentUser.uid, friendId].sort(),
        status: 'pending',
        senderName:
          profileName ||
          currentUser.displayName ||
          currentUser.email ||
          'Usuário do Kyrub',
        senderRole,
        senderAvatar: profilePhotoUrl || currentUser.photoURL || '',
        senderBio: profileAddress || '',
        receiverName:
          targetUser.name ||
          targetUser.email ||
          'Usuário do Kyrub',
        receiverRole: getUserRole(targetUser),
        receiverAvatar: targetUser.photoUrl || '',
        receiverBio:
          targetUser.bio ||
          targetUser.whatsapp ||
          '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      triggerToast('Solicitação de conexão enviada!', 'success');
    } catch (error) {
      console.error('Falha ao alterar conexão:', error);
      triggerToast('Não foi possível atualizar a conexão.', 'error');
    }
  };

  // Get Suggested Friends
  const getSuggestions = () => {
    const currentUid = auth.currentUser?.uid;

    return dbUsers
      .filter(
        user =>
          user.id !== currentUid &&
          user.isProfileVisible !== false
      )
      .map(user => {
        const connection = connections.find(item =>
          item.participantIds?.includes(user.id)
        );

        const connectionStatus =
          connection?.status === 'accepted'
            ? 'accepted'
            : connection?.status === 'pending' &&
                connection.senderId === currentUid
              ? 'pending_sent'
              : connection?.status === 'pending'
                ? 'pending_received'
                : 'none';

        const existingFriend = friends.find(
          friend => friend.id === user.id
        );

        return {
          id: user.id,
          name: user.name || user.email || 'Usuário do Kyrub',
          role: getUserRole(user),
          added: connectionStatus === 'accepted',
          avatar: user.photoUrl || '',
          bio: user.bio || user.whatsapp || '',
          isProfileVisible: true,
          favorited: existingFriend?.favorited ?? false,
          connectionStatus,
          connectionId: connection?.id
        } as Friend;
      })
      .filter(
        friend =>
          friend.connectionStatus !== 'accepted' &&
          friend.connectionStatus !== 'pending_received'
      );
  };

  // Favorite Friend toggle
  const handleToggleFavoriteFriend = (friendId: string) => {
    setFriends(prev =>
      prev.map(f => {
        if (f.id !== friendId) return f;
        const nowFavorited = !(f as any).favorited;
        triggerToast(nowFavorited ? `${f.name} adicionado aos favoritos!` : `${f.name} removido dos favoritos.`, 'success');
        return { ...f, favorited: nowFavorited } as any;
      })
    );
  };

  // Favorite Store toggle
  const handleToggleFavoriteStore = (storeId: string) => {
    if (favoriteStoreIds.includes(storeId)) {
      setFavoriteStoreIds(prev => prev.filter(id => id !== storeId));
      triggerToast('Loja removida dos favoritos!', 'info');
    } else {
      setFavoriteStoreIds(prev => [...prev, storeId]);
      triggerToast('Loja favoritada!', 'success');
    }
  };

  // Accept Connection Request
  const handleAcceptRequest = async (request: any) => {
    const currentUser = auth.currentUser;

    if (!currentUser) return;

    const connectionId =
      request.connectionId ||
      getConnectionId(currentUser.uid, request.id);

    try {
      await updateDoc(doc(db, 'connections', connectionId), {
        status: 'accepted',
        acceptedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      triggerToast(
        `Solicitação de ${request.name} aceita!`,
        'success'
      );
    } catch (error) {
      console.error('Falha ao aceitar conexão:', error);
      triggerToast(
        'Não foi possível aceitar a solicitação.',
        'error'
      );
    }
  };

  // Decline Connection Request
  const handleDeclineRequest = async (
    requestUserId: string,
    requestName: string
  ) => {
    const currentUser = auth.currentUser;

    if (!currentUser) return;

    const connectionId = getConnectionId(
      currentUser.uid,
      requestUserId
    );

    try {
      await deleteDoc(doc(db, 'connections', connectionId));

      triggerToast(
        `Solicitação de ${requestName} recusada.`,
        'info'
      );
    } catch (error) {
      console.error('Falha ao recusar conexão:', error);
      triggerToast(
        'Não foi possível recusar a solicitação.',
        'error'
      );
    }
  };

  return {
    friends,
    setFriends,
    dbUsers,
    setDbUsers,
    connectionRequests,
    setConnectionRequests,
    favoriteStoreIds,
    setFavoriteStoreIds,
    handleToggleFriend,
    getSuggestions,
    handleToggleFavoriteFriend,
    handleToggleFavoriteStore,
    handleAcceptRequest,
    handleDeclineRequest
  };
}
