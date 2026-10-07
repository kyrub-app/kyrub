import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc, type Unsubscribe } from 'firebase/firestore';
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
