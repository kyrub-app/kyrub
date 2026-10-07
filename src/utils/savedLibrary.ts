import { collection, deleteDoc, doc, getDoc, onSnapshot, serverTimestamp, setDoc, updateDoc, type Unsubscribe } from 'firebase/firestore';
import { auth, db } from './firebase';

export type SavedSourceKind = 'praca' | 'community';

export interface SavedPublication {
  id: string;
  sourceId: string;
  sourceKind: SavedSourceKind;
  selectionIds: string[];
  savedAt: string;
}

const currentUser = () => {
  const user = auth.currentUser;
  if (!user) throw new Error('Entre no Kyrub para acessar seus Salvos.');
  return user;
};

const idFor = (kind: SavedSourceKind, sourceId: string) =>
  (kind + '__' + sourceId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);

export const subscribeSavedPublications = (
  onChange: (items: SavedPublication[]) => void,
  onError?: (error: Error) => void
): Unsubscribe => {
  const user = currentUser();
  return onSnapshot(collection(db, 'users', user.uid, 'savedItems'), snapshot => {
    onChange(snapshot.docs.flatMap(item => {
      const data = item.data();
      const sourceId = typeof data.sourceId === 'string' ? data.sourceId : '';
      if (!sourceId || data.type !== 'publication') return [];
      return [{
        id: item.id,
        sourceId,
        sourceKind: data.sourceKind === 'community' ? 'community' : 'praca',
        selectionIds: Array.isArray(data.selectionIds)
          ? data.selectionIds.filter((value): value is string => typeof value === 'string')
          : [],
        savedAt: typeof data.savedAtIso === 'string' ? data.savedAtIso : '',
      }];
    }));
  }, error => onError?.(error));
};

export const savePublication = async (
  sourceKind: SavedSourceKind,
  sourceId: string,
  selectionIds: string[] = []
): Promise<void> => {
  const user = currentUser();
  const nowIso = new Date().toISOString();
  await setDoc(doc(db, 'users', user.uid, 'savedItems', idFor(sourceKind, sourceId)), {
    type: 'publication',
    sourceKind,
    sourceId,
    selectionIds: Array.from(new Set(selectionIds)),
    savedAtIso: nowIso,
    savedAt: serverTimestamp(),
  });
};

export const removeSavedPublication = async (
  sourceKind: SavedSourceKind,
  sourceId: string
): Promise<void> => {
  const user = currentUser();
  await deleteDoc(doc(db, 'users', user.uid, 'savedItems', idFor(sourceKind, sourceId)));
};


export interface SavedSelection {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export const subscribeSelections = (
  onChange: (items: SavedSelection[]) => void,
  onError?: (error: Error) => void
): Unsubscribe => {
  const user = currentUser();
  return onSnapshot(collection(db, 'users', user.uid, 'selections'), snapshot => {
    onChange(snapshot.docs.map(item => {
      const data = item.data();
      return {
        id: item.id,
        name: typeof data.name === 'string' ? data.name : 'Seleção',
        createdAt: typeof data.createdAtIso === 'string' ? data.createdAtIso : '',
        updatedAt: typeof data.updatedAtIso === 'string' ? data.updatedAtIso : '',
      };
    }));
  }, error => onError?.(error));
};

export const createSelection = async (name: string): Promise<string> => {
  const user = currentUser();
  const cleanName = name.trim().slice(0, 80);
  if (!cleanName) throw new Error('Informe um nome para a Seleção.');
  const reference = doc(collection(db, 'users', user.uid, 'selections'));
  const nowIso = new Date().toISOString();
  await setDoc(reference, {
    name: cleanName,
    createdAtIso: nowIso,
    createdAt: serverTimestamp(),
    updatedAtIso: nowIso,
    updatedAt: serverTimestamp(),
  });
  return reference.id;
};


export interface ResolvedSavedPublication extends SavedPublication {
  authorName: string;
  content: string;
  mediaUrls: string[];
  available: boolean;
}

export const resolveSavedPublication = async (
  item: SavedPublication
): Promise<ResolvedSavedPublication> => {
  const path = item.sourceKind === 'community' ? 'community_posts' : 'social_posts';
  const snapshot = await getDoc(doc(db, path, item.sourceId));
  if (!snapshot.exists()) {
    return { ...item, authorName: '', content: '', mediaUrls: [], available: false };
  }
  const data = snapshot.data();
  return {
    ...item,
    authorName: typeof data.authorName === 'string'
      ? data.authorName
      : typeof data.user === 'string' ? data.user : 'Usuário Kyrub',
    content: typeof data.content === 'string' ? data.content : '',
    mediaUrls: Array.isArray(data.mediaUrls)
      ? data.mediaUrls.filter((value): value is string => typeof value === 'string')
      : [],
    available: true,
  };
};

export const setSavedPublicationSelections = async (
  item: SavedPublication,
  selectionIds: string[]
): Promise<void> => {
  const user = currentUser();
  await updateDoc(doc(db, 'users', user.uid, 'savedItems', item.id), {
    selectionIds: Array.from(new Set(selectionIds)),
  });
};
