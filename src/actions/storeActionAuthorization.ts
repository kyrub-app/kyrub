import type { User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../utils/firebase';
import {
  parseCanonicalStore,
  parseStoreMemberDirectoryRecord,
  type CanonicalStoreRecord,
  type StoreMemberDirectoryRecord,
} from '../utils/storeDirectory';
import {
  getStoreDocumentPath,
  getStoreMemberDocumentPath,
  hasStorePermission,
  type StorePermission,
  type StoreRole,
} from '../utils/storeSecurity';

export type AuthorizedStoreActionContext = {
  store: CanonicalStoreRecord;
  role: StoreRole;
  member: StoreMemberDirectoryRecord | null;
  permission: StorePermission;
};

export const authorizeStoreActionContext = (
  userId: string,
  store: CanonicalStoreRecord,
  member: StoreMemberDirectoryRecord | null,
  permission: StorePermission
): AuthorizedStoreActionContext => {
  const uid = userId.trim();
  if (!uid) throw new Error('O usuário autenticado não foi identificado.');

  if (store.ownerId === uid) {
    if (!hasStorePermission('owner', permission)) {
      throw new Error('Esta ação não está disponível para o proprietário da loja.');
    }
    return { store, role: 'owner', member: null, permission };
  }

  if (!member || member.userId !== uid || member.storeId !== store.id) {
    throw new Error('Você não possui acesso a esta loja.');
  }
  if (member.status !== 'active') {
    throw new Error('Seu acesso a esta loja não está ativo.');
  }
  if (!hasStorePermission(member.role, permission)) {
    throw new Error('Seu papel nesta loja não permite executar esta ação.');
  }

  return {
    store,
    role: member.role,
    member,
    permission,
  };
};

export const resolveAuthorizedStoreAction = async (
  user: Pick<User, 'uid'>,
  storeId: string,
  permission: StorePermission
): Promise<AuthorizedStoreActionContext> => {
  const normalizedStoreId = storeId.trim();
  if (!normalizedStoreId) {
    throw new Error('Selecione uma loja antes de executar esta ação.');
  }

  const storeSnapshot = await getDoc(
    doc(db, getStoreDocumentPath(normalizedStoreId))
  );
  const store = parseCanonicalStore(storeSnapshot.data());
  if (!store || store.id !== normalizedStoreId) {
    throw new Error('A loja selecionada não está disponível.');
  }

  if (store.ownerId === user.uid) {
    return authorizeStoreActionContext(user.uid, store, null, permission);
  }

  const memberSnapshot = await getDoc(
    doc(db, getStoreMemberDocumentPath(normalizedStoreId, user.uid))
  );
  const member = parseStoreMemberDirectoryRecord(memberSnapshot.data());

  return authorizeStoreActionContext(user.uid, store, member, permission);
};
