import { deleteDoc, doc } from 'firebase/firestore';
import { db } from './firebase';

export const deleteOwnedCloudNote = (
  ownerId: string,
  noteId: string
): Promise<void> =>
  deleteDoc(doc(db, 'users', ownerId, 'tasks', noteId));
