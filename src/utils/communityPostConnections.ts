import {
  collection, doc, getDoc, onSnapshot, query, serverTimestamp, setDoc, where,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from './firebase';

export interface CommunityPostConnection {
  id: string;
  senderId: string;
  receiverId: string;
  status: 'pending' | 'accepted';
  senderName?: string;
  receiverName?: string;
}

export interface CommunityPublicProfile {
  id: string;
  name: string;
  avatar: string;
  role: string;
  bio: string;
  visible: boolean;
}

const connectionIdFor = (a: string, b: string) => [a, b].sort().join('_');

export const subscribeCommunityPostConnections = (
  userId: string,
  onChange: (connections: CommunityPostConnection[]) => void,
  onError: (error: Error) => void,
): Unsubscribe => onSnapshot(
  query(collection(db, 'connections'), where('participantIds', 'array-contains', userId)),
  snapshot => onChange(snapshot.docs.flatMap(item => {
    const data = item.data();
    return (data.senderId === userId || data.receiverId === userId) &&
      (data.status === 'pending' || data.status === 'accepted')
      ? [{
          id: item.id,
          senderId: data.senderId as string,
          receiverId: data.receiverId as string,
          status: data.status as 'pending' | 'accepted',
          senderName: typeof data.senderName === 'string' ? data.senderName : '',
          receiverName: typeof data.receiverName === 'string' ? data.receiverName : '',
        }] : [];
  })),
  onError,
);

export const readCommunityPostPublicProfile = async (userId: string): Promise<CommunityPublicProfile> => {
  if (!userId || !/^[a-zA-Z0-9_-]{1,128}$/.test(userId)) throw new Error('Perfil inválido.');
  const snapshot = await getDoc(doc(db, 'users', userId));
  if (!snapshot.exists()) throw new Error('Perfil não encontrado.');
  const data = snapshot.data();
  const visible = data.isProfileVisible === true;
  return {
    id: userId,
    name: visible && typeof data.name === 'string' && data.name ? data.name : 'Kairubido',
    avatar: visible && typeof data.photoUrl === 'string' ? data.photoUrl : '',
    role: visible && typeof data.role === 'string' ? data.role : 'Kairubido',
    bio: visible && typeof data.bio === 'string' ? data.bio : '',
    visible,
  };
};

export const requestCommunityPostConnection = async (userId: string): Promise<void> => {
  const user = auth.currentUser;
  if (!user) throw new Error('Entre no Kyrub para conectar.');
  if (userId === user.uid) throw new Error('Não é possível conectar consigo mesmo.');
  const profile = await readCommunityPostPublicProfile(userId);
  if (!profile.visible) throw new Error('Este perfil não aceita novas conexões.');
  const id = connectionIdFor(user.uid, userId);
  // A create-only rule rejects duplicate or pre-existing pending/accepted records,
  // rather than accidentally disconnecting a friend.
  await setDoc(doc(db, 'connections', id), {
    senderId: user.uid,
    receiverId: userId,
    participantIds: [user.uid, userId].sort(),
    status: 'pending',
    senderName: (user.displayName || 'Kairubido').slice(0, 160),
    senderRole: 'Cliente',
    senderAvatar: user.photoURL || '',
    senderBio: '',
    receiverName: profile.name,
    receiverRole: profile.role,
    receiverAvatar: profile.avatar,
    receiverBio: profile.bio,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};
