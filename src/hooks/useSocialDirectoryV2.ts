import { useCallback, useEffect, useState, type SetStateAction } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
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

// Bind all transient directory data to the exact Auth session, not just a
// boolean login state. Stale subscription callbacks cannot repopulate it.
const EMPTY_DIRECTORY:never[]=[];
function useSessionDirectoryState<T>(session:User|null){
  const [state,setState]=useState<{session:User|null;items:T[]}>(()=>({session,items:[]}));
  const setItems=useCallback((update:SetStateAction<T[]>)=>{
    if(!session||auth.currentUser!==session)return;
    setState(previous=>{
      if(auth.currentUser!==session)return previous;
      const items=previous.session===session?previous.items:EMPTY_DIRECTORY;
      return {session,items:typeof update==='function'?update(items):update};
    });
  },[session]);
  return [session&&auth.currentUser===session&&state.session===session?state.items:EMPTY_DIRECTORY,setItems] as const;
}

export function useSocialDirectoryV2({
  profileName,
  profilePhotoUrl,
  accountTypeLojista,
  accountTypeEntregador,
  isLoggedIn,
  triggerToast
}: UseSocialDirectoryOptions) {
  // Social states
  const [session,setSession]=useState(()=>auth.currentUser);
  useEffect(()=>onAuthStateChanged(auth,setSession),[]);
  const [friends,setFriends]=useSessionDirectoryState<Friend>(session);
  const [dbUsers,setDbUsers]=useSessionDirectoryState<any>(session);
  const [connectionRequests,setConnectionRequests]=useSessionDirectoryState<any>(session);
  const [connections,setConnections]=useSessionDirectoryState<ConnectionDocument>(session);

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
    const currentUser = session;

    if (!isLoggedIn || !currentUser || auth.currentUser!==currentUser) {
      setConnections([]);
      return;
    }

    const connectionsQuery = query(
      collection(db, 'connections'),
      where('participantIds', 'array-contains', currentUser.uid)
    );

    let active=true;
    const stop=onSnapshot(
      connectionsQuery,
      snapshot => {
        if(!active||auth.currentUser!==currentUser)return;
        setConnections(
          snapshot.docs.map(snapshotDoc => ({
            ...(snapshotDoc.data() as Omit<ConnectionDocument, 'id'>),
            id: snapshotDoc.id
          })).filter(item=>item.senderId===currentUser.uid||item.receiverId===currentUser.uid)
        );
      },
      error => {
        if(!active||auth.currentUser!==currentUser)return;
        console.error('Falha ao escutar conexões:', error);
        setConnections([]);
      }
    );
    return ()=>{active=false;stop();};
  }, [isLoggedIn,session,setConnections]);
  useEffect(() => {
    const currentUid = session?.uid;

    if (!isLoggedIn || !currentUid || auth.currentUser!==session) {
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
            snapshotBio ||
            previousFriend?.bio ||
            '',
          isProfileVisible:
            dbUser?.isProfileVisible === true,
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
            connection.senderBio ||
            '',
          connectionStatus: 'pending_received'
        };
      });

    setConnectionRequests(incomingRequests);
  }, [connections, dbUsers, isLoggedIn,session,setFriends,setConnectionRequests]);

  // Connect / Disconnect Friends
  const handleToggleFriend = async (friendId: string) => {
    const currentUser = auth.currentUser;

    if (!currentUser || currentUser!==session) {
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

      if (!targetUser || targetUser.isProfileVisible!==true) {
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
          'Usuário do Kyrub',
        senderRole,
        senderAvatar: profilePhotoUrl || currentUser.photoURL || '',
        senderBio: '', // Never copy a legacy address or other ambiguous private field.
        receiverName:
          targetUser.name ||
          'Usuário do Kyrub',
        receiverRole: getUserRole(targetUser),
        receiverAvatar: targetUser.photoUrl || '',
        receiverBio:
          targetUser.bio ||
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
    if(!session||auth.currentUser!==session)return [];
    const currentUid = session.uid;

    return dbUsers
      .filter(
        user =>
          user.id !== currentUid &&
          user.isProfileVisible === true
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
          name: user.name || 'Usuário do Kyrub',
          role: getUserRole(user),
          added: connectionStatus === 'accepted',
          avatar: user.photoUrl || '',
          bio: user.bio || '',
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

    if (!currentUser || currentUser!==session) return;

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

    if (!currentUser || currentUser!==session) return;

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
