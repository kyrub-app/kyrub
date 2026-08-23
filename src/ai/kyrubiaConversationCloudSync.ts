import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../utils/firebase';
import {
  loadKyrubAiConversations,
  saveKyrubAiConversations,
  type KyrubAiLocalConversation,
} from './conversationStore';

const CLOUD_COLLECTION = 'kyrubiaConversations';
const MAX_CLOUD_CONVERSATIONS = 20;

type MinimalStorage = Pick<Storage, 'getItem' | 'setItem'>;

const createMemoryStorage = (): MinimalStorage => {
  const values = new Map<string, string>();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
};

/**
 * Reuses the local conversation store as the single sanitizer/size authority.
 * This intentionally strips anything that the local store would not accept,
 * including attachment payloads that are not private Storage references.
 */
export const sanitizeKyrubAiCloudConversations = (
  conversations: KyrubAiLocalConversation[]
): KyrubAiLocalConversation[] => {
  const memory = createMemoryStorage();
  saveKyrubAiConversations(
    memory as Storage,
    'cloud-sanitizer',
    conversations
  );
  return loadKyrubAiConversations(memory as Storage, 'cloud-sanitizer');
};

export const mergeKyrubAiConversationHistories = (
  local: KyrubAiLocalConversation[],
  cloud: KyrubAiLocalConversation[]
): KyrubAiLocalConversation[] => {
  const byId = new Map<string, KyrubAiLocalConversation>();

  for (const conversation of sanitizeKyrubAiCloudConversations(local)) {
    byId.set(conversation.id, conversation);
  }
  for (const conversation of sanitizeKyrubAiCloudConversations(cloud)) {
    const current = byId.get(conversation.id);
    if (!current || conversation.updatedAt > current.updatedAt) {
      byId.set(conversation.id, conversation);
    }
  }

  return sanitizeKyrubAiCloudConversations(
    [...byId.values()].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt)
    )
  ).slice(0, MAX_CLOUD_CONVERSATIONS);
};

const collectionRef = (uid: string) =>
  collection(db, 'users', uid, CLOUD_COLLECTION);

const parseCloudSnapshot = (snapshot: { docs: Array<{ data: () => unknown }> }) => {
  const candidates = snapshot.docs
    .map(item => item.data())
    .map(value => {
      if (!value || typeof value !== 'object') return null;
      const candidate = value as Record<string, unknown>;
      return candidate.conversation ?? null;
    })
    .filter((value): value is KyrubAiLocalConversation => Boolean(value));
  return sanitizeKyrubAiCloudConversations(candidates);
};

export const subscribeKyrubAiCloudConversations = (
  uid: string,
  onChange: (conversations: KyrubAiLocalConversation[]) => void,
  onError?: (error: Error) => void
): Unsubscribe => {
  if (!uid) return () => undefined;
  return onSnapshot(
    collectionRef(uid),
    snapshot => onChange(parseCloudSnapshot(snapshot)),
    error => onError?.(error instanceof Error ? error : new Error(String(error)))
  );
};

export const persistKyrubAiCloudConversations = async (
  uid: string,
  conversations: KyrubAiLocalConversation[]
): Promise<void> => {
  if (!uid) return;
  const sanitized = sanitizeKyrubAiCloudConversations(conversations)
    .slice(0, MAX_CLOUD_CONVERSATIONS);
  if (sanitized.length === 0) return;

  const batch = writeBatch(db);
  for (const conversation of sanitized) {
    batch.set(
      doc(db, 'users', uid, CLOUD_COLLECTION, conversation.id),
      {
        uid,
        conversationId: conversation.id,
        updatedAt: conversation.updatedAt,
        conversation,
        syncedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }
  await batch.commit();
};

export const deleteKyrubAiCloudConversation = async (
  uid: string,
  conversationId: string
): Promise<void> => {
  if (!uid || !conversationId) return;
  await deleteDoc(doc(db, 'users', uid, CLOUD_COLLECTION, conversationId));
};
