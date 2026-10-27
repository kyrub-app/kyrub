import { auth, db } from './firebase';
import { collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, where, type Unsubscribe } from 'firebase/firestore';

export interface CloudCommunityGroup {
  id: string;
  communityId: string;
  creatorId: string;
  name: string;
  memberIds: string[];
}

export function subscribeMyCommunityGroups(
  communityId: string,
  onChange: (groups: CloudCommunityGroup[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Entre no Kyrub para consultar seus grupos.');
  if (!communityId) throw new Error('Selecione uma comunidade.');
  return onSnapshot(
    query(collection(db, 'community_groups'), where('communityId', '==', communityId), where('memberIds', 'array-contains', uid)),
    snapshot => onChange(snapshot.docs.flatMap(entry => {
      const data = entry.data();
      if (data.communityId !== communityId) return [];
      return [{
        id: entry.id,
        communityId: data.communityId as string,
        creatorId: data.creatorId as string,
        name: data.name as string,
        memberIds: Array.isArray(data.memberIds) ? data.memberIds as string[] : [],
      }];
    })),
    error => onError(error)
  );
}

export async function createPrivateCommunityGroup(
  communityId: string,
  name: string,
): Promise<string> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Entre no Kyrub para criar um grupo.');
  const cleanName = name.trim();
  if (!cleanName || cleanName.length > 80) throw new Error('Informe um nome de até 80 caracteres.');
  if (!communityId || communityId.length > 128) throw new Error('Comunidade inválida.');
  const memberIds = [uid];
  const groupRef = doc(collection(db, 'community_groups'));
  await setDoc(groupRef, {
    groupId: groupRef.id,
    communityId,
    creatorId: uid,
    name: cleanName,
    memberIds,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return groupRef.id;
}

export interface CloudCommunityGroupMessage {
  id: string;
  authorId: string;
  text: string;
  createdAt: Date | null;
}

export function subscribeCommunityGroupMessages(
  groupId: string,
  onChange: (messages: CloudCommunityGroupMessage[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  if (!auth.currentUser?.uid) throw new Error('Entre no Kyrub para ler as mensagens.');
  if (!groupId || groupId.includes('/')) throw new Error('Grupo inválido.');
  return onSnapshot(
    query(collection(db, 'community_groups', groupId, 'messages'), orderBy('createdAt', 'desc'), limit(100)),
    snapshot => onChange(snapshot.docs.map(entry => {
      const data = entry.data();
      return {
        id: entry.id,
        authorId: String(data.authorId || ''),
        text: String(data.text || ''),
        createdAt: data.createdAt?.toDate?.() ?? null,
      };
    }).reverse()),
    onError
  );
}

export async function sendCommunityGroupMessage(groupId: string, text: string): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Entre no Kyrub para enviar mensagens.');
  if (!groupId || groupId.includes('/')) throw new Error('Grupo inválido.');
  const content = text.trim();
  if (!content || content.length > 3000) throw new Error('Escreva uma mensagem de até 3.000 caracteres.');
  await setDoc(doc(collection(db, 'community_groups', groupId, 'messages')), {
    authorId: uid,
    text: content,
    createdAt: serverTimestamp(),
  });
}
